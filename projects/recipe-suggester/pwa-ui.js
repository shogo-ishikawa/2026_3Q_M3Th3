/** 個人の記録には触れず、ホーム画面への追加とオフライン準備の状態を案内します。 */
const state = document.getElementById('offline-state');
const installButton = document.getElementById('install-meal-palette');
const instructions = document.getElementById('home-install-help');
const standalone = window.matchMedia('(display-mode: standalone)');
let installOffer;

function updateInstallGuide() {
  const installed = standalone.matches || navigator.standalone === true;
  installButton.hidden = installed || !installOffer;
  instructions.hidden = installed;
  document.getElementById('home-installed').hidden = !installed;
}

window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  installOffer = event;
  updateInstallGuide();
});
window.addEventListener('appinstalled', () => {
  installOffer = null;
  installButton.hidden = true;
  instructions.hidden = true;
  document.getElementById('home-installed').hidden = false;
});
standalone.addEventListener('change', updateInstallGuide);
installButton.addEventListener('click', async () => {
  if (!installOffer) return;
  const offer = installOffer;
  installOffer = null;
  updateInstallGuide();
  try {
    await offer.prompt();
    await offer.userChoice;
  } catch {
    // ブラウザーのメニューからも追加できます。
  }
});
updateInstallGuide();

const readyText = 'オフラインで使えます。';
const failedText = 'オフラインの準備ができませんでした。通信できるときにもう一度開いてください。';
function showWorkerState(registration) {
  if (registration.waiting) {
    state.textContent = '更新を準備しました。Meal Palette の画面をすべて閉じてから開くと新しい版に切り替わります。';
  } else if (registration.active?.state === 'activated') {
    state.textContent = readyText;
  } else if (registration.installing || registration.active) {
    state.textContent = 'オフラインで使うためのデータを準備しています…';
  } else {
    state.textContent = failedText;
  }
}

async function prepareOffline() {
  if (!window.isSecureContext || !('serviceWorker' in navigator)) {
    state.textContent = 'この環境ではオフライン機能を利用できません。';
    return;
  }
  try {
    const registration = await navigator.serviceWorker.register('./service-worker.js', {
      scope: './', updateViaCache: 'none'
    });
    const watch = () => {
      const worker = registration.installing || registration.waiting || registration.active;
      worker?.addEventListener('statechange', () => showWorkerState(registration));
      showWorkerState(registration);
    };
    registration.addEventListener('updatefound', watch);
    watch();
    navigator.serviceWorker.ready.then(() => showWorkerState(registration));
  } catch {
    state.textContent = failedText;
  }
}
prepareOffline();
