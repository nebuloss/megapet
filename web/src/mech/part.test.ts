import { describe, expect, it } from 'vitest';
import { Assembly, Attribute, Derived, Flag, Quantity, RecordingScene, type Part } from './part';

/** A stand-in machine: a fork whose throw everything else is derived from. */
function machine(state: { throw_: number; car: number }) {
  const reversing = new Assembly(
    'reversing',
    new Derived('fork', () => `rotate(${(state.throw_ * 40).toFixed(1)})`),
    new Derived('brake', () => `rotate(${(state.throw_ * -6).toFixed(1)})`),
    new Derived('lever', () => `rotate(${(state.throw_ * 24).toFixed(1)})`),
  );
  const hoist = new Assembly(
    'hoist',
    new Derived('car', () => `translate(0 ${state.car.toFixed(1)})`),
    new Derived('weight', () => `translate(0 ${(300 - state.car).toFixed(1)})`),
    new Derived('rope', () => `M 0 ${state.car.toFixed(1)} V 0`, 'path'),
  );
  return new Assembly('machine', reversing, hoist);
}

describe('an assembly', () => {
  it('places everything in it, at any depth', () => {
    const scene = new RecordingScene();
    machine({ throw_: 0.5, car: 250 }).place(scene);
    expect([...scene.transforms.keys()].sort()).toEqual([
      'brake',
      'car',
      'fork',
      'lever',
      'weight',
    ]);
    expect(scene.paths.get('rope')).toBe('M 0 250.0 V 0');
  });

  it('lists its parts in order, so the machine can be read off', () => {
    const names = [...machine({ throw_: 0, car: 206 }).walk()].map((p) => p.name);
    expect(names).toEqual([
      'reversing',
      'fork',
      'brake',
      'lever',
      'hoist',
      'car',
      'weight',
      'rope',
    ]);
  });

  it('finds a part by name wherever it sits', () => {
    const m = machine({ throw_: 0, car: 206 });
    expect(m.find('lever')?.name).toBe('lever');
    expect(m.find('hoist')).toBeInstanceOf(Assembly);
    expect(m.find('flywheel')).toBeUndefined();
  });

  it('takes parts added after it was built', () => {
    const scene = new RecordingScene();
    const m = new Assembly('m').add(new Derived('lamp', () => 'translate(1 2)'));
    m.place(scene);
    expect(scene.transforms.get('lamp')).toBe('translate(1 2)');
  });

  it('composes: an assembly is a part, so assemblies nest', () => {
    const inner = new Assembly('inner', new Derived('bolt', () => 'rotate(1)'));
    const outer = new Assembly('outer', inner);
    const scene = new RecordingScene();
    outer.place(scene);
    expect(scene.transforms.get('bolt')).toBe('rotate(1)');
    expect([...outer.walk()].map((p) => p.name)).toEqual(['inner', 'bolt']);
  });
});

describe('a derived part', () => {
  it('stores nothing, so it cannot fall out of step with the machine', () => {
    const state = { throw_: 0, car: 206 };
    const m = machine(state);
    const first = new RecordingScene();
    m.place(first);
    state.throw_ = 1;
    state.car = 298;
    const second = new RecordingScene();
    m.place(second);
    // The same objects, re-read: every derived part followed, with nothing
    // to update and nothing left holding the old value.
    expect(first.transforms.get('fork')).toBe('rotate(0.0)');
    expect(second.transforms.get('fork')).toBe('rotate(40.0)');
    expect(second.transforms.get('brake')).toBe('rotate(-6.0)');
    expect(second.transforms.get('weight')).toBe('translate(0 2.0)');
  });

  it('gives the same answer however many times it is asked', () => {
    const m = machine({ throw_: 0.25, car: 240 });
    const a = new RecordingScene();
    const b = new RecordingScene();
    m.place(a);
    m.place(b);
    expect(a.snapshot()).toBe(b.snapshot());
  });
});

describe('the other things a part can say', () => {
  it('sets an attribute, for a rope end or an arc offset', () => {
    const state = { car: 206 };
    const scene = new RecordingScene();
    const rope = new Attribute('carRope', 'y2', () => state.car.toFixed(1));
    rope.place(scene);
    expect(scene.attrs.get('carRope.y2')).toBe('206.0');
    state.car = 298;
    rope.place(scene);
    expect(scene.attrs.get('carRope.y2')).toBe('298.0');
  });

  it('raises a flag and reports a quantity, both derived like anything else', () => {
    const state = { braked: false, effort: 0 };
    const scene = new RecordingScene();
    const machine = new Assembly(
      'machine',
      new Flag('braked', () => state.braked),
      new Quantity('effort', () => state.effort.toFixed(2)),
    );
    machine.place(scene);
    expect(scene.flags.get('braked')).toBe(false);
    expect(scene.quantities.get('effort')).toBe('0.00');
    state.braked = true;
    state.effort = 0.75;
    machine.place(scene);
    expect(scene.flags.get('braked')).toBe(true);
    expect(scene.quantities.get('effort')).toBe('0.75');
  });
});

describe('a recording scene', () => {
  it('captures flags and quantities as well as positions', () => {
    const scene = new RecordingScene();
    const part: Part = {
      name: 'machine',
      place(s) {
        s.flag('braked', true);
        s.quantity('effort', '0.8');
        s.attr('shaft', 'height', '172');
      },
    };
    part.place(scene);
    expect(scene.flags.get('braked')).toBe(true);
    expect(scene.quantities.get('effort')).toBe('0.8');
    expect(scene.attrs.get('shaft.height')).toBe('172');
    expect(scene.snapshot()).toContain('flag braked true');
  });
});
