import fs from "fs";
import { parse } from "node-html-parser";

const htmlPath = "c:\\Users\\lenov\\Downloads\\MahiStream\\temp_kurama.html";
const rawHtml = fs.readFileSync(htmlPath, "utf-16le");
const document = parse(rawHtml);

console.log("=== Body Text Content ===");
const bodyText = document.querySelector("body")?.text || "";
// clean up extra whitespaces to make it readable
console.log(bodyText.replace(/\s+/g, ' ').trim().slice(0, 3000));
