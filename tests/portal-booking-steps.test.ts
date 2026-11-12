import { test } from "node:test";
import assert from "node:assert/strict";
import { displayStepFor, DISPLAY_STEPS } from "../src/lib/portal/portal-booking-steps.ts";

test("displayStepFor agrupa os 6 estados internos em 3 passos visuais", () => {
  assert.equal(displayStepFor("service"), 1);
  assert.equal(displayStepFor("professional"), 2);
  assert.equal(displayStepFor("slot"), 2);
  assert.equal(displayStepFor("auth"), 3);
  assert.equal(displayStepFor("confirm"), 3);
  assert.equal(displayStepFor("done"), 3);
});

test("DISPLAY_STEPS tem exatamente 3 passos, na ordem certa", () => {
  assert.equal(DISPLAY_STEPS.length, 3);
  assert.deepEqual(
    DISPLAY_STEPS.map((s) => s.number),
    [1, 2, 3],
  );
  assert.deepEqual(
    DISPLAY_STEPS.map((s) => s.label),
    ["Serviço", "Agenda", "Confirmação"],
  );
});
