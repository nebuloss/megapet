/**
 * The instrument: the dial face, and the movement behind it.
 *
 * A dial is a pointer and the gears it turns. Both are read here rather than
 * recomputed: the arc from where the pointer is, and each gear from the shaft
 * that actually turned, so the drawing cannot quietly disagree with the train
 * that drove it.
 */
import { Assembly, Attribute, Derived, Quantity, toDegrees, type Rotation } from '../../../../mech';
import type { Pointer } from '../../pointer';
import { ARC_LENGTH } from '../layout';

export function instrument(pointer: Pointer, hub: Rotation, lay: Rotation): Assembly {
  return new Assembly(
    'instrument',
    new Derived('hub', () => `rotate(${toDegrees(hub.phase).toFixed(2)})`),
    new Derived('lay', () => `rotate(${toDegrees(lay.phase).toFixed(2)})`),
    new Attribute('valueArc', 'stroke-dashoffset', () =>
      String(ARC_LENGTH * (1 - pointer.position)),
    ),
    // How hard the machine is working, for the stylesheet to lean on.
    new Quantity('lift-effort', () => pointer.position.toFixed(3)),
  );
}
