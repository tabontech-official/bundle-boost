import { isRouteErrorResponse, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

/**
 * Route-level error UI rendered inside the embedded admin frame. Responses
 * thrown by Shopify authentication (re-auth, bounce pages) are handed to the
 * library's boundary so their headers and scripts still work.
 */
export function RouteError() {
  const error = useRouteError();
  const notFound = isRouteErrorResponse(error) && error.status === 404;
  if (isRouteErrorResponse(error) && !notFound) {
    return boundary.error(error);
  }

  const errorMessage =
    error instanceof Error
      ? error.message
      : typeof error === "object" && error && "message" in error
        ? String((error as { message: unknown }).message)
        : String(error ?? "");

  return (
    <s-page heading={notFound ? "Not found" : "Something went wrong"}>
      <s-section>
        <s-stack direction="block" gap="base">
          <s-banner tone={notFound ? "warning" : "critical"}>
            <s-paragraph>
              {notFound
                ? "This item doesn't exist or was deleted."
                : errorMessage ||
                  "We couldn't load this page. Refresh to try again. If the problem continues, contact support."}
            </s-paragraph>
          </s-banner>
          <s-stack direction="inline" gap="base">
            <s-button href="/app">Back to overview</s-button>
          </s-stack>
        </s-stack>
      </s-section>
    </s-page>
  );
}
