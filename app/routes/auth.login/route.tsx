import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { useLoaderData, type LoaderFunctionArgs } from "react-router";
import { login } from "../../shopify.server";
import { loginErrorMessage } from "./error.server";

/**
 * Shopify can send merchants here with ?shop=…; `login` then redirects them
 * to install/authorize. There's no form to type a shop domain: App Store
 * apps are installed and opened from Shopify only.
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const errors = loginErrorMessage(await login(request));
  return { errors };
};

export default function Auth() {
  const { errors } = useLoaderData<typeof loader>();
  return (
    <AppProvider embedded={false}>
      <s-page>
        <s-section heading="Open SaleLoop from Shopify">
          <s-paragraph>
            Open SaleLoop from your Shopify admin (Apps → SaleLoop), or install it from the Shopify App Store.
          </s-paragraph>
          {errors.shop && <s-paragraph tone="critical">{errors.shop}</s-paragraph>}
        </s-section>
      </s-page>
    </AppProvider>
  );
}
