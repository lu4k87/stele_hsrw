// Kurzform für Icons in der Admin-Oberfläche: icon('stele'), icon('check', { size: 16, label: 'Erledigt' }).
import { iconSvg, ICONS, TILE_ICONS, TILE_ICON_LABELS } from '/shared/icons.js';

export { ICONS, TILE_ICONS, TILE_ICON_LABELS };

export function icon(name, opts = {}) {
  return iconSvg(name, { size: 20, ...opts });
}
