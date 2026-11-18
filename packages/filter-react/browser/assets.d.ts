// The style sheet as the tests load it. Vite, the server that runs the tests, handles both.

/** Loading a style sheet adds it to the page. */
declare module "*.css";

/** With "?inline" the style sheet is not added to the page. Its text is handed back. */
declare module "*.css?inline" {
  const text: string;
  export default text;
}
