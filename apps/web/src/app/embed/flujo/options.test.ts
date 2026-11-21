import { describe, expect, it } from "vitest";

import { parseEmbedOptions } from "./options";

const parse = (query: string) => parseEmbedOptions(new URLSearchParams(query));

describe("parseEmbedOptions", () => {
  it("uses presentation defaults", () => {
    expect(parse("")).toEqual({ autoPlay: true, loop: true, speed: 1, controls: true, panels: true, presence: true });
  });

  it("reads every parameter", () => {
    expect(parse("autoplay=0&loop=false&speed=1.5&controls=0&panels=no&presence=0&owners=ana,bob@sideband.app")).toEqual({
      autoPlay: false,
      loop: false,
      speed: 1.5,
      controls: false,
      panels: false,
      presence: false,
      owners: ["ana", "bob@sideband.app"],
    });
  });

  it("ignores out of range speeds and invalid owners", () => {
    expect(parse("speed=40&owners=<script>,ana")).toMatchObject({ speed: 1, owners: ["ana"] });
  });
});
