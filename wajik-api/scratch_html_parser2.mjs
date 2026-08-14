import { parse } from "node-html-parser";
const doc = parse('<source src="http://a.com?a=1&amp;b=2">');
console.log(doc.querySelector('source').getAttribute('src'));
