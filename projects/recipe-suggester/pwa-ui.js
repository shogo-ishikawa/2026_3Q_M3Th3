/** 個人の記録には触れず、ホーム画面への追加とオフライン準備の状態を案内します。 */
const state = document.getElementById('offline-state');
const installButtons = document.querySelectorAll('[data-install-app]');
const guide = document.getElementById('install-guide');
const standalone = window.matchMedia('(display-mode: standalone)');
let installOffer;
let installedThisVisit = false;
let promptPending = false;
let guideOpener;

function updateInstallGuide() {
  const installed = installedThisVisit || standalone.matches || navigator.standalone === true;
  for (const button of installButtons) {
    button.hidden = installed;
    button.disabled = promptPending;
  }
  document.getElementById('home-installed').hidden = !installed;
  if (installed && guide.open) guide.close();
}

function showInstallGuide(button) {
  const ua = navigator.userAgent;
  const isAppleMobile = /iPhone|iPad|iPod/i.test(ua) ||
    (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1);
  document.getElementById('install-ios-guide').hidden = /Android/i.test(ua);
  document.getElementById('install-android-guide').hidden = isAppleMobile;
  guideOpener = button;
  guide.showModal();
}

async function installApp(event) {
  const button = event.currentTarget;
  if (!installOffer) {
    showInstallGuide(button);
    return;
  }

  const offer = installOffer;
  installOffer = null;
  promptPending = true;
  updateInstallGuide();
  try {
    await offer.prompt();
    await offer.userChoice;
  } catch {
    if (!button.hidden) showInstallGuide(button);
  } finally {
    promptPending = false;
    updateInstallGuide();
  }
}

window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  installOffer = event;
  updateInstallGuide();
});
window.addEventListener('appinstalled', () => {
  installOffer = null;
  installedThisVisit = true;
  updateInstallGuide();
});
standalone.addEventListener('change', updateInstallGuide);
for (const button of installButtons) button.addEventListener('click', installApp);
document.getElementById('close-install-guide').addEventListener('click', () => guide.close());
guide.addEventListener('close', () => {
  if (guideOpener && !guideOpener.hidden) guideOpener.focus();
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
