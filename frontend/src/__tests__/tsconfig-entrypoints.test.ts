import * as fs from "fs";
import * as path from "path";

describe("tsconfig.json entrypoint coverage", () => {
  const tsconfigPath = path.resolve(__dirname, "../../tsconfig.json");
  const tsconfig = JSON.parse(fs.readFileSync(tsconfigPath, "utf-8"));

  it.each(["App.tsx", "index.ts"])(
    "includes %s in the include array",
    (entrypoint) => {
      expect(tsconfig.include).toEqual(
        expect.arrayContaining([entrypoint])
      );
    }
  );
});
