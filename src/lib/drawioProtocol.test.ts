// @vitest-environment node
import fixture from "../../web-platform/tests/fixtures/drawio-embed-protocol.json";
import { describe, expect, it } from "vitest";
import { isMatchingDrawioXmlSvgExportResponse } from "./drawio";

describe("draw.io embed export protocol", () => {
  it("accepts the official xmlsvg request echoed by an svg response", () => {
    expect(isMatchingDrawioXmlSvgExportResponse(fixture.validResponse, fixture.request.message)).toBe(true);
  });

  it.each([
    ["stale response", fixture.staleResponse],
    ["unsolicited response", fixture.unsolicitedResponse],
    ["wrong response format", fixture.wrongFormatResponse],
    ["wrong export request format", fixture.wrongRequestFormatResponse],
    ["missing response message", fixture.missingMessageResponse],
    ["non object response", fixture.nonObjectResponse],
  ])("rejects %s", (_label, response) => {
    expect(isMatchingDrawioXmlSvgExportResponse(response, fixture.request.message)).toBe(false);
  });
});
