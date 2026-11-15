// Input: keyboard state, pointer-lock mouse look, and the fire button. Look
// deltas are consumed once per frame by the main loop (takeLook), so a frame
// never reads the same mouse movement twice.
export function createInput(element, onLockChange) {
  const state = {
    keys: new Set(),
    firing: false,
    locked: false,
    lookX: 0,
    lookY: 0,
  };

  function onKey(e, down) {
    if (e.code === 'Space') e.preventDefault();
    if (down) state.keys.add(e.code);
    else state.keys.delete(e.code);
  }

  window.addEventListener('keydown', (e) => onKey(e, true));
  window.addEventListener('keyup', (e) => onKey(e, false));
  window.addEventListener('blur', () => {
    state.keys.clear();
    state.firing = false;
  });
  document.addEventListener('pointerlockchange', () => {
    state.locked = document.pointerLockElement === element;
    if (!state.locked) state.firing = false;
    onLockChange(state.locked);
  });
  document.addEventListener('mousemove', (e) => {
    if (!state.locked) return;
    state.lookX += e.movementX;
    state.lookY += e.movementY;
  });
  element.addEventListener('mousedown', (e) => {
    if (e.button === 0) state.firing = true;
  });
  window.addEventListener('mouseup', (e) => {
    if (e.button === 0) state.firing = false;
  });

  return {
    state,
    requestLock() {
      element.requestPointerLock();
    },
    releaseLock() {
      if (document.pointerLockElement) document.exitPointerLock();
    },
    takeLook() {
      const look = { x: state.lookX, y: state.lookY };
      state.lookX = 0;
      state.lookY = 0;
      return look;
    },
  };
}
