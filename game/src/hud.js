// HUD: every DOM write goes through here, once per frame at most, so the
// simulation never touches the document. Overlays (start, pause, buy, round
// end, match end) are plain panels the main loop shows and hides.
import { WEAPONS, GEAR } from './state.js';

const $ = (id) => document.getElementById(id);

export function createHud(callbacks) {
  const el = {
    hud: $('hud'), hp: $('hp'), hpFill: $('hp-fill'), armor: $('armor-line'),
    ammoMag: $('ammo-mag'), ammoReserve: $('ammo-reserve'), ammoBox: $('ammo'),
    weaponName: $('weapon-name'), money: $('money'),
    timer: $('timer'), roundLabel: $('round-label'),
    scoreUs: $('score-us'), scoreThem: $('score-them'),
    teamStatus: $('team-status'), killfeed: $('killfeed'),
    crosshair: $('crosshair'), hitmarker: $('hitmarker'),
    vignette: $('vignette'), flash: $('flash'),
    prompt: $('prompt'), plantBar: $('plant-bar'), plantFill: $('plant-fill'),
    banner: $('banner'), bannerTitle: $('banner-title'), bannerSub: $('banner-sub'),
    bombStatus: $('bomb-status'),
    overlay: $('overlay'), overlayTitle: $('overlay-title'), overlayCopy: $('overlay-copy'),
    play: $('play'), buyOverlay: $('buy-overlay'), buyGrid: $('buy-grid'), buyMoney: $('buy-money'),
    buyClose: $('buy-close'),
  };
  let hitTimer = null;
  let lastHp = -1;
  let lastMag = -1;

  function show(el2) { el2.hidden = false; }
  function hide(el2) { el2.hidden = true; }

  el.play.addEventListener('click', () => callbacks.onPlay());
  el.buyClose.addEventListener('click', () => callbacks.onBuyClose());

  function buildBuy(state) {
    el.buyGrid.innerHTML = '';
    const items = [
      ...Object.values(WEAPONS).filter((w) => w.price > 0),
      ...Object.values(GEAR),
    ];
    items.forEach((item, i) => {
      const owned = item.id in (state.player?.owned ?? {}) || state.player?.weapon === item.id;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'buy-item' + (owned ? ' owned' : '');
      btn.disabled = state.money < item.price && !owned;
      btn.innerHTML = `<span><span class="key">${i + 1}</span> <b>${item.name}</b><span class="desc">${item.desc}</span></span><span class="price">${owned ? 'OWNED' : '$' + item.price}</span>`;
      btn.addEventListener('click', () => callbacks.onBuy(item.id));
      el.buyGrid.appendChild(btn);
    });
    el.buyMoney.textContent = `$${state.money}`;
  }

  return {
    setHealth(hp, armor) {
      if (hp === lastHp) return;
      lastHp = hp;
      el.hp.textContent = Math.max(0, Math.ceil(hp));
      el.hp.classList.toggle('low', hp <= 30);
      el.hpFill.style.width = `${Math.max(0, hp)}%`;
      el.hpFill.style.background = hp <= 30 ? '#ef4444' : '#2dd4bf';
      el.armor.textContent = armor > 0 ? `ARMOR ${Math.ceil(armor)}` : 'ARMOR —';
    },
    setAmmo(mag, reserve, name) {
      if (mag === lastMag) return;
      lastMag = mag;
      el.ammoMag.textContent = mag;
      el.ammoReserve.textContent = `/ ${reserve}`;
      el.ammoBox.classList.toggle('empty', mag === 0);
      el.weaponName.textContent = name;
    },
    setMoney(money) { el.money.textContent = `$${money}`; },
    setTimer(seconds, phase) {
      const s = Math.max(0, Math.ceil(seconds));
      el.timer.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
      el.timer.classList.toggle('low', s <= 10 && phase === 'live');
      el.roundLabel.textContent = phase === 'buy' ? 'BUY PHASE' : `ROUND ${window.__round ?? ''}`;
    },
    setScore(us, them, round) {
      el.scoreUs.textContent = us;
      el.scoreThem.textContent = them;
      window.__round = round;
    },
    setTeamStatus(actors) {
      let html = '';
      for (const team of ['us', 'them']) {
        for (const a of actors.filter((x) => x.team === team)) {
          const cls = team === 'us' ? 'us' : 'them';
          const dead = a.hp <= 0 ? ' dead' : '';
          html += `<div class="${cls}${dead}">${a.name} — ${a.hp > 0 ? Math.ceil(a.hp) : 'DOWN'}</div>`;
        }
      }
      el.teamStatus.innerHTML = html;
    },
    killfeed(text, team) {
      const div = document.createElement('div');
      div.innerHTML = text;
      el.killfeed.prepend(div);
      while (el.killfeed.children.length > 4) el.killfeed.lastChild.remove();
      setTimeout(() => div.remove(), 6000);
    },
    hitmarker(kill) {
      el.hitmarker.classList.add('on');
      el.hitmarker.classList.toggle('kill', kill);
      clearTimeout(hitTimer);
      hitTimer = setTimeout(() => el.hitmarker.classList.remove('on'), 90);
    },
    damageFlash() {
      el.vignette.style.opacity = '1';
      setTimeout(() => { el.vignette.style.opacity = '0'; }, 180);
    },
    flashWhite(strength) {
      el.flash.style.opacity = String(Math.min(1, strength));
      setTimeout(() => { el.flash.style.opacity = '0'; }, 120);
    },
    setPrompt(text) {
      if (!text) { hide(el.prompt); return; }
      el.prompt.innerHTML = text;
      show(el.prompt);
    },
    setPlantBar(progress) {
      if (progress == null) { hide(el.plantBar); return; }
      show(el.plantBar);
      el.plantFill.style.width = `${Math.round(progress * 100)}%`;
    },
    setBombStatus(text) {
      if (!text) { hide(el.bombStatus); return; }
      el.bombStatus.textContent = text;
      show(el.bombStatus);
    },
    banner(title, sub, kind) {
      el.bannerTitle.textContent = title;
      el.bannerSub.textContent = sub;
      el.banner.className = `show ${kind ?? ''}`;
      clearTimeout(this._bannerTimer);
      this._bannerTimer = setTimeout(() => { el.banner.className = ''; }, 3600);
    },
    hideBanner() { el.banner.className = ''; },
    showOverlay(kind, data) {
      if (kind === 'start') {
        el.overlayTitle.innerHTML = 'HARBOUR<span class="accent">FALL</span>';
        el.overlayCopy.textContent = 'Pier 9, container yard after dark. Tidebreakers attack, Dockwardens hold the sites. Plant the surge charge at Crane Bay or Fuel Depot — or wipe the other team out. First to 5 rounds takes the pier.';
        el.play.textContent = 'Deploy';
      } else if (kind === 'paused') {
        el.overlayTitle.textContent = 'Paused';
        el.overlayCopy.textContent = 'Click Deploy to jump back in. Your team is holding without you.';
        el.play.textContent = 'Deploy';
      } else if (kind === 'round') {
        el.overlayTitle.textContent = data.title;
        el.overlayCopy.textContent = data.sub;
        el.play.textContent = 'Next round';
      } else if (kind === 'match') {
        el.overlayTitle.textContent = data.title;
        el.overlayCopy.textContent = data.sub;
        el.play.textContent = 'Play again';
      }
      show(el.overlay);
    },
    hideOverlay() { hide(el.overlay); },
    showBuy(state) { buildBuy(state); show(el.buyOverlay); },
    hideBuy() { hide(el.buyOverlay); },
    buyVisible() { return !el.buyOverlay.hidden; },
    refreshBuy(state) { if (!el.buyOverlay.hidden) buildBuy(state); },
  };
}
