import { ControlPanelController } from "../../src/sdk/ControlPanelController";
import { MapController } from "../../src/sdk/MapController";
import { Player } from "../../src/sdk/Player";
import { Viewport } from "../../src/sdk/Viewport";
import { Viewport3d } from "../../src/sdk/Viewport3d";
import { World } from "../../src/sdk/World";
import { XpDropController } from "../../src/sdk/XpDropController";
import { TestRegion } from "../../src/sdk/testing/TestRegion";

const renderedCanvases: unknown[] = [];

// jsdom has no WebGL context.
jest.mock("three", () => ({
  ...jest.requireActual("three"),
  __esModule: true,
  default: class Stats {
    dom = document.createElement("div");
    update() {}
  },
  GLTFLoader: class {
    setMeshoptDecoder() {
      return this;
    }
  },
  WebGLRenderer: class {
    domElement: unknown;
    constructor({ canvas }: { canvas: unknown }) {
      this.domElement = canvas;
      renderedCanvases.push(canvas);
    }
    render() {}
    setSize() {}
  },
}));

type Call = [string, ...unknown[]];

// jsdom has no 2D canvas context or OffscreenCanvas.
const contexts = new WeakMap<object, { calls: Call[] }>();
function contextOf(canvas: object) {
  if (!contexts.has(canvas)) {
    const calls: Call[] = [];
    const state: Record<string | symbol, unknown> = { canvas, calls };
    contexts.set(canvas, new Proxy(state, {
      get: (target, key) => key in target ? target[key] : (...args: unknown[]) => {
        calls.push([String(key), ...args]);
        return { width: 0, addColorStop() {} };
      },
      set: (target, key, value) => {
        target[key] = value;
        return true;
      },
    }) as { calls: Call[] });
  }
  return contexts.get(canvas)!;
}

class RecordedOffscreenCanvas {
  constructor(public width: number, public height: number) {}
  getContext() {
    return contextOf(this);
  }
}

class UnmodelledPlayer extends Player {
  override get3dModel() {
    return null;
  }
}

const WORLD_STYLE = "height: 100%; image-rendering: pixelated; inset: 0px; position: absolute; width: 100%;";

describe("3D present", () => {
  let area: HTMLDivElement;
  let worldCanvas: HTMLCanvasElement;

  beforeEach(() => {
    renderedCanvases.length = 0;
    Object.defineProperty(globalThis, "OffscreenCanvas", { configurable: true, value: RecordedOffscreenCanvas });
    jest.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (this: HTMLCanvasElement, type: string) {
      return type === "2d" ? contextOf(this) as never : null;
    });
    jest.spyOn(window, "requestAnimationFrame").mockReturnValue(0);
    area = document.createElement("div");
    worldCanvas = document.createElement("canvas");
    worldCanvas.id = "world";
    worldCanvas.style.cssText = WORLD_STYLE;
    area.append(worldCanvas);
    document.body.append(area);
  });

  afterEach(() => {
    area.remove();
    jest.restoreAllMocks();
  });

  test("the renderer draws into a hidden canvas under the world canvas, laid out like it", () => {
    new Viewport3d(true, worldCanvas);

    expect({
      children: Array.from(area.children).map((child) => [child.id, child.getAttribute("style"), (child as HTMLElement).hidden]),
      rendersIntoFirstChild: renderedCanvases[0] === area.children[0],
    }).toEqual({
      children: [["", WORLD_STYLE, true], ["world", WORLD_STYLE, false]],
      rendersIntoFirstChild: true,
    });
  });

  test("a frame clears the world canvas, copies only the UI layer onto it and shows the 3D layer", () => {
    const automockedHudControllers = [ControlPanelController.controller, XpDropController.controller, MapController.controller];
    automockedHudControllers.forEach((controller) => Object.assign(controller, { draw() {} }));
    const delegate = new Viewport3d(true, worldCanvas);
    const region = new TestRegion(20, 20);
    const world = new World();
    region.world = world;
    world.addRegion(region);
    const player = new UnmodelledPlayer(region, { x: 10, y: 10 });
    region.addPlayer(player);
    Viewport.viewport = new Viewport(delegate, worldCanvas, area);
    Viewport.viewport.setPlayer(player);
    Viewport.viewport.resize(1280, 800);
    const rendered = renderedCanvases[0];
    const name = (canvas: unknown) => `${canvas === rendered ? "3D" : "2D"} ${(canvas as HTMLCanvasElement).width}x${(canvas as HTMLCanvasElement).height}`;
    const worldCalls = contextOf(worldCanvas).calls;
    worldCalls.length = 0;

    Viewport.viewport.draw(world);

    expect({
      covering: worldCalls
        .filter(([method, x, y, width, height]) => (method === "fillRect" || method === "clearRect") && [x, y, width, height].join() === "0,0,1280,800")
        .map(([method]) => method),
      canvasCopies: worldCalls
        .filter(([method, source]) => method === "drawImage" && (source === rendered || source instanceof RecordedOffscreenCanvas))
        .map(([, source, x, y]) => [name(source), x, y]),
      layerHidden: (rendered as HTMLCanvasElement).hidden,
    }).toEqual({
      covering: ["clearRect"],
      canvasCopies: [["2D 1280x800", 0, 0]],
      layerHidden: false,
    });
  });
});
