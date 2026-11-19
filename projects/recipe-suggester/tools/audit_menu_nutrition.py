"""Verify the catalogue against the MEXT workbook and export the public audit CSV."""
import argparse
import csv
from collections import Counter
from decimal import Decimal, ROUND_HALF_UP
from hashlib import sha256
from io import StringIO
import json
from math import fsum, isclose, isfinite
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / 'docs/menu-nutrition-audit.csv'
KEYS = ('kcal', 'protein', 'fat', 'carbs', 'fiber', 'salt')
COLUMNS = ('ENERC_KCAL', 'PROT-', 'FAT-', 'CHOCDF-', 'FIB-', 'NACL_EQ')
NAMES = ('エネルギー', 'たんぱく質', '脂質', '炭水化物', '食物繊維', '食塩相当量')
MEXT = 'https://www.mext.go.jp/a_menu/syokuhinseibun/mext_00001.html'
CODE = re.compile(r'食品番号[：: 　]*(\d{5})')
URL = re.compile(r'https?://[\w./?=&%~:+#@;,()!\-]+',re.ASCII)
OFFICIAL_SHA = '0d5a77077dd6cd91cbc2e6e317b8b218a38728c409eed452f1c10635a0d3099c'
BASIS = {'ingredients':'材料から概算','official':'公式表示値（参考）','unknown':'栄養値未登録',
         'estimate':'参考配合から概算','mixed':'公式表示値と材料の概算'}
OCCASIONS = ('朝食','昼食','夕食','間食','晩酌')
JS = """
import {INGREDIENTS,RECIPES} from './data.js';
import {quickFoodCategory} from './quick-foods.js';
import {recipeNutrition} from './nutrition.js';
import {deriveRecipeBasis} from './nutrition-basis.js';
import {recipePortion,recipeFamily} from './catalog.js';
import {hasReviewedMealOccasions,mealOccasionsFor,recipeSceneIds,SCENE_LABELS} from './meal-occasions.js';
const data={ingredients:INGREDIENTS};
console.log(JSON.stringify({ingredients:INGREDIENTS,recipes:RECIPES.map(r=>({...r,
    quickCategory:quickFoodCategory(r.id),result:recipeNutrition(r,data),basis:deriveRecipeBasis(r,data),size:recipePortion(r,data),
    family:recipeFamily(r),occasions:mealOccasionsFor(r),scenes:recipeSceneIds(r).map(id => SCENE_LABELS[id]),reviewed:hasReviewedMealOccasions(r)}))}));
"""

def require(test, message):
    if not test:
        raise ValueError(message)

def close(a, b, label):
    match = a == b if a is None or b is None else isclose(a,b,abs_tol=1e-7,rel_tol=1e-8)
    require(match, f'{label}: {a} != {b}')

def value(cell):
    term = str(cell).strip().rstrip('†').strip('()')
    if term in ('Tr', '-', '', 'None'):
        return None
    return float(term)

def reference_code(profile):
    source = profile.get('rawNutritionSource') or profile.get('nutritionSource','')
    code = CODE.search(source)
    if code:
        return code[1]
    url_code = re.search(r'ITEM_NO=\d+_(\d{5})_7',source)
    return url_code[1] if url_code else None

def verify_reference(path, ingredients):
    from openpyxl import load_workbook
    require(sha256(path.read_bytes()).hexdigest() == OFFICIAL_SHA, 'Unexpected workbook revision')
    workbook = load_workbook(path, read_only=True, data_only=True)
    rows = iter(workbook['表全体'].values)
    for row in rows:
        if 'ENERC_KCAL' in row:
            indices = [row.index(col) for col in COLUMNS]
            break
    table = {str(row[1]).strip(): [value(row[i]) for i in indices] for row in rows
             if re.fullmatch(r'\d{5}',str(row[1]).strip())}
    workbook.close()
    salt_replacements = {
        'soba': table['01130'][KEYS.index('salt')] * 2.6/100,
        'somen': table['01044'][KEYS.index('salt')] * 2.7/100,
        'cashew': 16 * 2.54/1000/100,  # USDA dry-roasted unsalted, sodium 16 mg/100 g
    }
    checked, exceptions, unique = 0, 0, set()
    for ingredient, profile in ingredients.items():
        code = reference_code(profile)
        if code is None:
            continue
        grams = profile.get('gramsPerUnit', 1 if profile['unit']=='g' else None)
        require(grams is not None, f'{ingredient}: missing unit conversion')
        original = profile.get('rawNutritionPerUnit',profile['nutritionPerUnit'])
        unique.add(code)
        for key, per100 in zip(KEYS,table[code]):
            actual = original[key]
            expected = None if per100 is None else per100 * grams / 100
            if ingredient in salt_replacements and key=='salt':
                require(actual is None and key in profile['estimatedNutrients'],ingredient)
                close(profile['nutritionPerUnit'][key],salt_replacements[ingredient],ingredient+' cooked/unsalted salt')
                exceptions += 1
                continue
            if ingredient=='seafood_inada':
                require(actual is None and key in profile['estimatedNutrients'],ingredient)
                actual = profile['nutritionPerUnit'][key]
            if ingredient in ('stock_kombu_strained','stock_bonito_strained'):
                # Material unit is 1 g dry. Reference unit is 100 g of filtered broth.
                extraction = 880/30 if ingredient=='stock_kombu_strained' else 860/30
                expected = None if expected is None else expected * extraction
                if ingredient=='stock_bonito_strained' and key=='salt':
                    close(profile['nutritionPerUnit']['salt'],table['10092'][KEYS.index('salt')]/100,'shaved bonito salt ceiling')
                    exceptions += 1
                    continue
            close(actual,expected,f'{ingredient}/{code}/{key}')
            checked += 1
    print(f'MEXT: {checked} cells ({len(unique)} food codes), {exceptions} documented substitutions.')

def calc_parts(recipe, ingredients, key):
    weights = []
    for part in recipe['ingredients']:
        quantity = ingredients[part['id']]['nutritionPerUnit'][key]
        if quantity is None:
            return None
        weights.append(quantity * part['amount'])
    return fsum(weights)/recipe['servings']

def display(n, key):
    if n is None:
        return ''
    places = Decimal('1') if key=='kcal' else Decimal('0.1')
    return str(Decimal(str(n)).quantize(places,rounding=ROUND_HALF_UP))

def check_mass(n, grams, label):
    if not grams:
        return
    for key in ('protein','fat','carbs','salt','fiber'):
        require(n[key] is None or n[key]<=grams*1.015, label+' '+key+' exceeds mass')
    require(n['kcal'] is None or n['kcal']<=grams*9.2, label+' energy density')
    macro = [n[key] for key in ('protein','fat','carbs')]
    if None not in macro:
        require(sum(macro)<=grams*1.04, label+' total macros exceed mass')

def audit(catalogue):
    ingredients, recipes = catalogue['ingredients'], catalogue['recipes']
    for key, ingredient in ingredients.items():
        profile=ingredient['nutritionPerUnit']
        require(all(x is None or (isfinite(x) and x>=0) for x in profile.values()),key)
        grams=ingredient.get('gramsPerUnit', 1 if ingredient['unit']=='g' else None)
        check_mass(profile,grams,key)
    output = StringIO(newline='')
    csvout = csv.writer(output,lineterminator='\n')
    csvout.writerow(['料理ID','料理名','基準量',*[name+unit for name,unit in zip(NAMES,['(kcal)']+['(g)']*5)],
                     '計算の根拠','未確定の成分',*OCCASIONS,'行事・シーン','食品番号（文科省）','資料URL','確認内容・注意点'])
    counts = Counter()
    seen = set()
    recipes_by_id = {recipe['id']: recipe for recipe in recipes}
    for r in recipes:
        key = r['id']
        require(key not in seen and r['reviewed'] and r['occasions'],key)
        seen.add(key)
        parts = r['ingredients']
        require(r['servings']>0 and r['size']['amount']>0 and parts,key)
        require(all(p['id'] in ingredients and p['amount']>0 and isfinite(p['amount']) for p in parts),key)
        n = r['result']
        for nutrient in KEYS:
            require(n[nutrient] is None or (isfinite(n[nutrient]) and n[nutrient]>=0),key)
            independent = r['manualNutrition'].get(nutrient) if 'manualNutrition' in r else calc_parts(r,ingredients,nutrient)
            close(n[nutrient],independent,key+'/'+nutrient)
        if r['size']['unit']=='g':
            check_mass(n,r['size']['amount'],key)
        e,p,f,c,fi,salt = (n[k] for k in KEYS)
        require(fi is None or c is None or fi<=c+0.15,key+' fiber > carbs')
        remark = []
        if None not in (e,p,f,c) and abs(e-(4*p+9*f+4*c))>max(30,0.2*e):
            require(r['family']=='alcohol',key+' unexpected kcal/PFC gap')
            remark.append('アルコール由来のエネルギーを含む')
            counts['alcohol'] += 1
        if salt is not None and salt>6:
            require(r['family'] in ('soba','udon','ramen'),key+' salt outlier')
            remark.append('麺とつゆを全量摂る場合');counts['salty'] += 1
        if fi is not None and fi>20:
            require(key=='varied-chickpea-spice',key+' fiber outlier')
            remark.append('ゆでひよこ豆の配合量を確認');counts['fibre'] += 1
        if key in ('drink-water','drink-carbonated-water') or len(parts)==1 and parts[0]['id'] in ('water','carbonated_water'):
            remark.append('水・無糖炭酸水の6成分は定義値')
        if e==0:
            require(r['role']=='drink',key+' zero energy');remark.append('無糖飲料またはゼロ表示')
        basis = BASIS[r['basis']]
        counts[r['basis']] += 1
        missing = [label for k,label in zip(KEYS,NAMES) if n[k] is None]
        counts['partial' if missing else 'complete'] += 1
        refs = [ingredients[p['id']] for p in parts]
        urls = list(dict.fromkeys(URL.findall(r.get('sourceNote',''))))
        codes = set()
        category = r['quickCategory']
        if category:
            sources = category['referenceIds']
            grams = category.get('referenceGrams')
            if grams:
                codes.update(reference_code(ingredients[source]) for source in sources)
                require(None not in codes, key+' missing ingredient reference')
                urls.append(MEXT)
                values = [ingredients[source]['nutritionPerUnit'] for source in sources]
            else:
                for source in sources:
                    source_urls = URL.findall(recipes_by_id[source]['sourceNote'])
                    require(source_urls, source+' missing product reference')
                    urls.extend(source_urls)
                values = [recipes_by_id[source]['manualNutrition'] for source in sources]
            for nutrient in KEYS:
                samples = [value[nutrient] for value in values]
                if None in samples:
                    require(n[nutrient] is None, key+' unreported '+nutrient)
                else:
                    expected = fsum(samples) * (grams or 1) / len(samples)
                    require(abs(n[nutrient] - expected) <= 0.000501, key+' reference value '+nutrient)
            basis = '市販ジャンルの代表値'
            remark.append('参照例：' + '・'.join(sources))
        elif r['basis'] in ('ingredients','mixed','estimate'):
            raw_codes = [reference_code(i) for i in refs]
            codes.update(code for code in raw_codes if code)
            if codes or r['basis']=='estimate':
                urls.append(MEXT)
            for i in refs:
                # MEXT codes are reported in their own column.
                urls.extend(u for u in URL.findall(i.get('nutritionSource','')) if 'fooddb.mext.go.jp' not in u)
            if any(i.get('estimatedNutrients') for i in refs):
                remark.append('材料に成分の概算補完あり')
            if r['basis']=='estimate':
                remark.append('一般商品の参考配合')
        if r['basis'] in ('official','mixed') or (missing and len(missing)==len(KEYS)):
            require(urls,key+' product source absent')
        if len(missing)==len(KEYS):
            remark.append('確認できた栄養値なし')
        elif missing:
            remark.append('未掲載・範囲表示・未測定等は空欄')
        csvout.writerow([key,r['name'],r['size']['label'],*[display(n[k],k) for k in KEYS],
                         basis,'・'.join(missing),*['○' if x in r['occasions'] else '' for x in OCCASIONS],
                         '・'.join(r['scenes']),' '.join(sorted(codes)),' '.join(dict.fromkeys(urls)),'／'.join(remark)])
    print(f'{len(recipes)} menus, {len(ingredients)} ingredients. {dict(counts)}')
    return output.getvalue().encode('utf-8-sig')

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--mext', type=Path, help='Official workbook, corrected 2026-03-27')
    parser.add_argument('--check',action='store_true',help='Compare the generated CSV to the published copy')
    args = parser.parse_args()
    data = json.loads(subprocess.check_output(['node','--input-type=module','-e',JS],cwd=ROOT))
    if args.mext:
        verify_reference(args.mext, data['ingredients'])
    contents = audit(data)
    if args.check:
        require(OUTPUT.read_bytes()==contents,'Stale audit CSV')
    else:
        OUTPUT.write_bytes(contents)
