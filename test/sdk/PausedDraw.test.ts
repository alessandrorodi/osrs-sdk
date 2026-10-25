import { TestRegion } from "../../src/sdk/testing/TestRegion";
import { Viewport } from "../../src/sdk/Viewport";
import { World } from "../../src/sdk/World";

describe("a paused world", () => {
  let world: World;
  let draws: number[];

  beforeEach(() => {
    const region = new TestRegion(40, 40);
    world = new World();
    region.world = world;
    world.addRegion(region);
    draws = [];
    Viewport.viewport = { tick: jest.fn(), clientTick: jest.fn(), draw: (drawn: World) => void draws.push(drawn.globalTickCounter) } as never;
    jest.spyOn(window, "requestAnimationFrame").mockReturnValue(0);
    jest.spyOn(window.performance, "now").mockReturnValue(1000);
  });

  afterEach(() => jest.restoreAllMocks());

  test("draws every frame before it first ticks, without ticking or counting GET READY down", () => {
    world.getReadyTimer = 6;
    world.startDrawing();
    world.browserLoop(5000);
    world.browserLoop(9000);

    expect([draws, world.globalTickCounter, world.getReadyTimer, world.tickPercent]).toEqual([[0, 0, 0], 0, 6, 0]);
  });

  test("keeps drawing the frozen tick after a stop, and resumes from that tick", () => {
    world.getReadyTimer = 0;
    world.startTicking();
    world.browserLoop(world.nextTickTimer + 1);
    world.stopTicking();
    world.browserLoop(60_000);
    world.browserLoop(120_000);
    const whilePaused = [...draws];
    world.startTicking();
    world.browserLoop(world.nextTickTimer + 1);

    expect([whilePaused, world.globalTickCounter]).toEqual([[0, 1, 1, 1], 2]);
  });

  test("starts drawing once however often it is asked", () => {
    const loop = jest.spyOn(world, "browserLoop");
    world.startDrawing();
    world.startDrawing();
    world.startTicking();

    expect(loop).toHaveBeenCalledTimes(1);
  });
});
