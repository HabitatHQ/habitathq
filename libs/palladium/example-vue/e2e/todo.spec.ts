import { expect, test } from "@playwright/test";

test("shows empty message when there are no todos", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("empty-message")).toBeVisible();
});

test("adds a todo and it appears in the list", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("new-task-input").fill("Buy milk");
  await page.getByTestId("add-task-btn").click();
  await expect(page.getByTestId("task-item")).toHaveCount(1);
  await expect(page.getByTestId("task-item")).toContainText("Buy milk");
});

test("clears the input after adding a todo", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("new-task-input").fill("Walk the dog");
  await page.getByTestId("add-task-btn").click();
  await expect(page.getByTestId("new-task-input")).toHaveValue("");
});

test("ignores empty submissions", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("add-task-btn").click();
  await expect(page.getByTestId("empty-message")).toBeVisible();
});

test("toggles a todo done", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("new-task-input").fill("Exercise");
  await page.getByTestId("add-task-btn").click();
  const checkbox = page.getByRole("checkbox", { name: "Exercise" });
  await checkbox.check();
  await expect(page.locator("li span.done")).toBeVisible();
  await expect(page.locator("li span.done")).toContainText("Exercise");
});

test("untoggling a done todo removes the done style", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("new-task-input").fill("Read");
  await page.getByTestId("add-task-btn").click();
  const checkbox = page.getByRole("checkbox", { name: "Read" });
  await checkbox.check();
  await checkbox.uncheck();
  await expect(page.locator("li span.done")).toHaveCount(0);
});

test("deletes a todo", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("new-task-input").fill("Temporary task");
  await page.getByTestId("add-task-btn").click();
  await expect(page.getByTestId("task-item")).toHaveCount(1);
  await page.getByRole("button", { name: "Delete Temporary task" }).click();
  await expect(page.getByTestId("empty-message")).toBeVisible();
});

test("adds multiple todos and they all appear", async ({ page }) => {
  await page.goto("/");
  for (const text of ["Alpha", "Beta", "Gamma"]) {
    await page.getByTestId("new-task-input").fill(text);
    await page.getByTestId("add-task-btn").click();
  }
  await expect(page.getByTestId("task-item")).toHaveCount(3);
});
