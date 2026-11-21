// Self-check: npm run check:places
import assert from 'node:assert/strict';
import { buildPlaces, searchPlaces } from './places.ts';
import type { Graph } from '../routing/index.ts';

// A plus-shaped junction: Ann St runs west–east through j, Brunswick St north–south.
const node = (id: string, lon: number, lat: number) => ({ id, lon, lat });
const edge = (id: string, a: string, b: string, name?: string) => ({ id, a, b, length_m: 50, name, geometry: [] });
const graph = {
  version: 1,
  bbox: [0, 0, 1, 1],
  venue: { name: 'Venue', lon: 0, lat: 0, node: 'w' },
  nodes: [node('w', -1, 0), node('j', 0, 0), node('e', 1, 0), node('n', 0, 1), node('s', 0, -1), node('x', 2, 0)],
  edges: [edge('1', 'w', 'j', 'Ann Street'), edge('2', 'j', 'e', 'Ann Street'), edge('3', 'n', 'j', 'Brunswick Street'), edge('4', 'j', 's', 'Brunswick Street'), edge('5', 'e', 'x')],
} as unknown as Graph;

const places = buildPlaces(graph);
const find = (label: string) => places.find((p) => p.label === label);
assert.equal(find('Tanda HQ (venue)')?.node, 'w');
assert.equal(find('Ann Street')?.node, 'j'); // middle of w–j–e
assert.equal(find('Brunswick Street')?.node, 'j');
assert.equal(find('Ann Street & Brunswick Street')?.node, 'j');
assert.equal(places.length, 4); // the unnamed edge adds nothing

assert.deepEqual(searchPlaces(places, 'bruns ann').map((p) => p.label), ['Ann Street & Brunswick Street']);
assert.deepEqual(searchPlaces(places, 'ANN').map((p) => p.label), ['Ann Street', 'Ann Street & Brunswick Street']);
assert.deepEqual(searchPlaces(places, 'nn'), []); // word starts only, so "nn" doesn't match "Ann"
assert.deepEqual(searchPlaces(places, '  '), []);
assert.deepEqual(searchPlaces(places, 'Ann Street & Brunswick Street').map((p) => p.label), ['Ann Street & Brunswick Street']); // a full label finds itself
assert.equal(searchPlaces(places, 'tanda')[0].node, 'w');
assert.equal(searchPlaces(places, 'venue')[0].node, 'w');

console.log('places self-check passed');
