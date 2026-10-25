import * as THREE from "three";
import { TextEncoder, TextDecoder } from "util";
import { CacheRenderModel } from "../src/sdk/rendering/CacheRenderModel";
import { CacheRender } from "../src/sdk/rendering/CacheRenderBundle";
import { crc32 } from "../src/cache-render-format";
import { Mob } from "../src/sdk/Mob";
import { TestRegion } from "../src/sdk/testing/TestRegion";

(global as any).TextDecoder = TextDecoder;

jest.mock("three", () => ({
  ...jest.requireActual("three"),
  GLTFLoader: class {
    setMeshoptDecoder() {}
  },
}));

const texture = (pixel: number) => ({ width: 1, height: 1, pixels: [pixel] });

// fetch is the network boundary.
function serveModel(payload: unknown) {
  const json = new TextEncoder().encode(JSON.stringify(payload));
  const body = new Uint8Array(8 + json.length);
  body.set([79, 83, 82, 66]);
  new DataView(body.buffer).setUint32(4, json.length, true);
  body.set(json, 8);
  const manifest = {
    schemaVersion: 3, bundleVersion: "material-groups", cache: { revision: 1, source: "fixture", contentHash: "1234abcd" },
    assets: { body: { file: "body.bin", crc32: crc32(body) } }, references: { "model:1": ["body"] },
  };
  (global as any).fetch = async (url: string) => url.endsWith("manifest.json")
    ? { ok: true, status: 200, json: async () => manifest }
    : { ok: true, status: 200, arrayBuffer: async () => body.slice().buffer };
  CacheRender.configure("http://localhost/assets/manifest.json");
}

afterEach(() => CacheRender.configure(null));

test("a textured model draws one group per run of triangles that share a material", async () => {
  const indices = [0, 1, 2, 2, 1, 3, 3, 4, 5, 5, 4, 6, 6, 7, 8, 8, 7, 9];
  serveModel({
    version: 2,
    positions: Array.from({ length: 30 }, (_, axis) => axis % 3 === 1 ? 0 : Math.floor(axis / 3) + axis % 2),
    indices,
    uvs: Array(20).fill(0),
    textures: { 7: texture(0xff112233), 9: texture(0xff445566) },
    textureIds: [7, 7, 7, 7, 7, 7, -1, -1, -1, 9, 9, 9, 9, 9, 9, 7, 7, 7],
  });
  const mob = new Mob(new TestRegion(20, 20), { x: 2, y: 2 });
  const model = new CacheRenderModel(mob, { kind: "model", modelId: 1 });
  await model.preload();
  const scene = new THREE.Scene();
  model.draw(scene, 0, 0, { x: 2, y: 2, z: 0 }, 0, 0, true, []);

  const meshes: THREE.Mesh[] = [];
  scene.traverse((object) => { if (object instanceof THREE.Mesh && object.userData.unit === mob) meshes.push(object); });
  expect(meshes).toHaveLength(1);
  const [mesh] = meshes;
  const materials = mesh.material as THREE.MeshBasicMaterial[];
  expect(mesh.geometry.groups.map(({ start, count, materialIndex }) => ({
    start, count, pixel: materials[materialIndex ?? -1]?.map?.image.data.slice(0, 3).join(",") ?? "untextured",
  }))).toEqual([
    { start: 0, count: 6, pixel: "17,34,51" },
    { start: 6, count: 3, pixel: "untextured" },
    { start: 9, count: 6, pixel: "68,85,102" },
    { start: 15, count: 3, pixel: "17,34,51" },
  ]);
  expect(Array.from(mesh.geometry.index?.array ?? [])).toEqual(indices);
});
