/**
 * The hoist: the sheave, the ropes, the car and the counterweight.
 *
 * One number moves here, and it is the car's. Everything else in the shaft is
 * read off it — the sheave has turned by however much rope has passed over it,
 * the counterweight is the car inverted, and each rope ends wherever the thing
 * it hangs from has got to. None of them stores anything, so none of them can
 * be left holding last frame's answer.
 */
import { Assembly, Attribute, Derived, Quantity, toDegrees } from '../../../../mech';
import { CAR, SHEAVE, WEIGHT } from '../layout';
import type { Car } from './car';

/**
 * @param effort How hard the machine is working, 0..1 — the speed the streaks
 * in the shaft blur past at and the rate the passenger bobs.
 */
export function hoist(car: Car, effort: () => number): Assembly {
  const weightTop = (): number => WEIGHT.low - (car.position - CAR.top);
  return new Assembly(
    'hoist',
    new Derived(
      'sheave',
      () =>
        `translate(${SHEAVE.x} ${SHEAVE.y}) ` +
        `rotate(${toDegrees((CAR.top - car.position) / SHEAVE.radius).toFixed(2)})`,
    ),
    new Derived('car', () => `translate(0 ${car.position.toFixed(2)})`),
    new Derived('weight', () => `translate(0 ${weightTop().toFixed(2)})`),
    new Attribute('carRope', 'y2', () => car.position.toFixed(2)),
    new Attribute('weightRope', 'y2', () => weightTop().toFixed(2)),
    new Quantity('streak-duration', () => `${(1.5 - effort() * 1.15).toFixed(2)}s`),
    new Quantity('nookie-bob', () => `${(2.6 - effort() * 1.8).toFixed(2)}s`),
  );
}
