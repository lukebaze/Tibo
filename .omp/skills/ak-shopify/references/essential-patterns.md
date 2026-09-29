# Essential Patterns

## GraphQL Product Query

```graphql
query GetProducts($first: Int!) {
  products(first: $first) {
    edges {
      node {
        id
        title
        handle
        variants(first: 5) {
          edges {
            node {
              id
              price
              inventoryQuantity
            }
          }
        }
      }
    }
    pageInfo {
      hasNextPage
      endCursor
    }
  }
}
```

## Checkout Extension (React)

```javascript
import { reactExtension, BlockStack, TextField, Checkbox } from '@shopify/ui-extensions-react/checkout';

export default reactExtension('purchase.checkout.block.render', () => <Extension />);

function Extension() {
  const [message, setMessage] = useState('');

  return (
    <BlockStack>
      <TextField label="Gift Message" value={message} onChange={setMessage} />
    </BlockStack>
  );
}
```

## Liquid Product Display

```liquid
{% for product in collection.products %}
  <div class="product-card">
    <img src="{{ product.featured_image | img_url: 'medium' }}" alt="{{ product.title }}">
    <h3>{{ product.title }}</h3>
    <p>{{ product.price | money }}</p>
    <a href="{{ product.url }}">View Details</a>
  </div>
{% endfor %}
```
