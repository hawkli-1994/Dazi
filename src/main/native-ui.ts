import { app, Menu, nativeImage, Tray, type BrowserWindow } from 'electron';

const labels = {
  zh: { show: '打开搭子', quit: '退出搭子', tooltip: '搭子 · 工作在继续' },
  en: { show: 'Open Dazi', quit: 'Quit Dazi', tooltip: 'Dazi · Work keeps moving' },
} as const;

export function createTray(show: () => void): Tray | null {
  // A bare Linux display (including Xvfb) has no system tray to reopen a hidden
  // window. In that environment closing the last window quits normally.
  if (process.platform === 'linux' && !process.env.XDG_CURRENT_DESKTOP) {
    console.info('[Desktop] No desktop tray is available; closing the window will quit.');
    return null;
  }
  try {
    const size = 20;
    const pixels = Buffer.alloc(size * size * 4);
    for (let y = 3; y < 17; y++) {
      for (let x = 3; x < 17; x++) {
        if (Math.abs(x - 9.5) + Math.abs(y - 9.5) > 9) continue;
        const offset = (y * size + x) * 4;
        pixels[offset] = 74;
        pixels[offset + 1] = 60;
        pixels[offset + 2] = 52;
        pixels[offset + 3] = 255;
      }
    }
    const icon = nativeImage.createFromBitmap(pixels, { width: size, height: size });
    icon.setTemplateImage(process.platform === 'darwin');
    const tray = new Tray(icon);
    const text = labels[app.getLocale().startsWith('zh') ? 'zh' : 'en'];
    tray.setToolTip(text.tooltip);
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: text.show, click: show },
        { type: 'separator' },
        { label: text.quit, click: () => app.quit() },
      ]),
    );
    tray.on('click', show);
    return tray;
  } catch {
    console.warn('[Desktop] The system tray is unavailable; closing the window will quit.');
    return null;
  }
}

export function showWindow(window: BrowserWindow): void {
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}
