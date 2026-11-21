// The parts of the package that need neither three.js nor a browser: the grid of days, the camera's geometry (for a place-holder drawn flat before the scene is there), and the adapters. Importing this does not load the scene.
export { fakeLayer, fromGitHubCalendar, fromRecords, fromWakaTimeSummaries } from "./adapters";
export type { GitHubContributionCalendar, WakaTimeSummaries } from "./adapters";
export { layoutGraph, layoutMatrix } from "./layout";
export type { Cell, Matrix } from "./layout";
export { CAMERA_DIR, placeholderTiles, PITCH, roomFor, slabFor, STRIP_GAP, TYPICAL_TALLEST } from "./view";
export type { ColorInput, DayValue, GraphData, GraphLayer, LayerColors, Rgb, Tones } from "./types";
