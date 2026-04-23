import "./style.css";
import dataset from "./data/philosophers.json";
import { renderTimeline } from "./viz/timeline";
import type { Dataset } from "./types";

const app = document.getElementById("app");
if (!app) {
  throw new Error("#app not found");
}

renderTimeline(app, dataset as Dataset);
