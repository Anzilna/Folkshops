import { descriptionToPlainText } from "./description-to-text";

describe("descriptionToPlainText", () => {
  test("plain text passes through unchanged", () => {
    expect(descriptionToPlainText("Soft linen shirt")).toBe("Soft linen shirt");
  });

  test("null stays null", () => {
    expect(descriptionToPlainText(null)).toBeNull();
  });

  test("Editor.js JSON becomes its visible text only — no block/format keywords", () => {
    const editorJs = JSON.stringify({
      time: 1,
      version: "2.30.0",
      blocks: [
        { type: "header", data: { text: "Linen <b>shirt</b>", level: 2 } },
        { type: "paragraph", data: { text: "Breathable&nbsp;&amp; light" } },
        { type: "list", data: { style: "unordered", items: ["Blue", { content: "White", items: [{ content: "Off-white", items: [] }] }] } },
      ],
    });
    const text = descriptionToPlainText(editorJs);
    expect(text).toBe("Linen shirt Breathable & light Blue White Off-white");
    expect(text).not.toMatch(/blocks|paragraph|version/);
  });

  test("JSON that isn't Editor.js is treated as plain text", () => {
    expect(descriptionToPlainText('{"hello":"world"}')).toBe('{"hello":"world"}');
  });
});
