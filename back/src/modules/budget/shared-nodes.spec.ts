import { describe, expect, it } from 'vitest';
import { sharedNodeIds } from './shared-nodes';

/**
 * Inheritance down the plan tree, on its own — no database, because the rule is arithmetic on a
 * tree and deserves to be readable as such.
 *
 * The mark sits on a NODE and reaches the subtree because that is the shape the customer's shared
 * money has: `1.100 ຄ່າບໍລິຫານ ທົວໄປ` and `1.400 ລາຍຈ່າຍປະຈຳເດືອນ` hold the office supplies, the
 * security guards and the phone bills between them, so two marks cover the lot — and every line
 * added under them later is covered without anyone remembering to tick it.
 */
const n = (id: string, parentId?: string, isShared = false) => ({ id, parentId, isShared });

describe('shared plan nodes', () => {
  it('shares a marked node itself', () => {
    expect([...sharedNodeIds([n('1', undefined, true)])]).toEqual(['1']);
  });

  it('shares everything beneath a marked node, however deep', () => {
    const shared = sharedNodeIds([
      n('1'),
      n('1.100', '1', true),
      n('1.101', '1.100'),
      n('1.101.a', '1.101'),
    ]);
    expect([...shared].sort()).toEqual(['1.100', '1.101', '1.101.a']);
  });

  it('leaves a sibling subtree alone', () => {
    // The whole point of marking a category rather than the department root: `1.400` is shared,
    // `1.200` is ບໍລິຫານ's own licences, and both hang off `1`.
    const shared = sharedNodeIds([
      n('1'),
      n('1.400', '1', true),
      n('1.401', '1.400'),
      n('1.200', '1'),
      n('1.201', '1.200'),
    ]);
    expect([...shared].sort()).toEqual(['1.400', '1.401']);
  });

  it('shares a whole department when its root is marked', () => {
    const shared = sharedNodeIds([n('1', undefined, true), n('1.100', '1'), n('1.101', '1.100')]);
    expect(shared.size).toBe(3);
  });

  it('marks nothing when nothing is marked', () => {
    expect(sharedNodeIds([n('1'), n('1.1', '1'), n('1.101', '1.1')]).size).toBe(0);
  });

  it('is unaffected by a second mark inside an already-shared subtree', () => {
    // Redundant but harmless: a reader marking a line under a marked category must not change
    // what is shared, only what is un-markable from where.
    const both = sharedNodeIds([n('1'), n('1.1', '1', true), n('1.101', '1.1', true)]);
    const one = sharedNodeIds([n('1'), n('1.1', '1', true), n('1.101', '1.1')]);
    expect([...both].sort()).toEqual([...one].sort());
  });

  it('ends the walk at a parent it was not given', () => {
    // A caller holding one department's nodes cannot see a mark placed above them. Answering
    // "not shared" is the honest answer for a partial set; guessing would be worse.
    expect(sharedNodeIds([n('1.101', '1.1')]).size).toBe(0);
  });

  it('refuses to spin on a cycle in bad data', () => {
    // `requireParent` forbids a cycle on write. If one ever reaches this function it must return,
    // not hang: an infinite loop in a picker read takes the request thread with it.
    const shared = sharedNodeIds([n('a', 'b'), n('b', 'a')]);
    expect(shared.size).toBe(0);
  });

  it('answers a deep chain in one pass per chain', () => {
    // Memoisation is not decoration: the customer's plan is 552 nodes and this runs on every
    // picker read. A chain of 500 must not be walked 500 times.
    const nodes = [n('0', undefined, true)];
    for (let i = 1; i < 500; i++) nodes.push(n(String(i), String(i - 1)));
    expect(sharedNodeIds(nodes).size).toBe(500);
  });
});
