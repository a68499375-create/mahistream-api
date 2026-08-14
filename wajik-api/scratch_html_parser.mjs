import { parse } from "node-html-parser";

const html = `
<video id="player" controls controlsList="nodownload">
  <source id="source1080" src="https://example.com/1080.mp4" type="video/mp4" size="1080">
  <source id="source720" src="https://example.com/720.mp4" type="video/mp4" size="720">
</video>
`;

const document = parse(html, { parseNoneClosedTags: true });
const player = document.querySelector("#player");
console.log("player:", player?.tagName);
const source = document.querySelector("#player source");
console.log("source src:", source?.getAttribute("src"));

// Try finding source inside video
const source2 = document.querySelector("video#player source");
console.log("source2 src:", source2?.getAttribute("src"));
