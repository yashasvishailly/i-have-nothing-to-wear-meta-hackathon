import type{Category,AccessoryRole}from'./core';
export interface SampleCollection{testedSourceSha256?:string;id:string;title:string;source:string;note:string;items:{name:string;category:Category;image:string;heels:boolean|null;sleeveless:boolean|null;accessoryRole?:AccessoryRole}[];}
// Exact approved synthetic sources and existing saved previews. No provider execution.
export const sampleCollections:SampleCollection[]=[
  {
    "title": "Colourful everyday outfit",
    "source": "/samples/sample-one-source.png",
    "items": [
      {
        "name": "Coral crew-neck top",
        "category": "top",
        "image": "/samples/sample-one-piece-0.png",
        "heels": null,
        "sleeveless": false
      },
      {
        "name": "Blue flared skirt",
        "category": "bottom",
        "image": "/samples/sample-one-piece-1.png",
        "heels": null,
        "sleeveless": null
      },
      {
        "name": "White low-top sneakers",
        "category": "shoes",
        "image": "/samples/sample-one-piece-2.png",
        "heels": false,
        "sleeveless": null
      },
      {
        "name": "Mustard top-handle bag",
        "category": "accessory",
        "image": "/samples/sample-one-piece-3.png",
        "heels": null,
        "sleeveless": null,
        "accessoryRole": "bag"
      },
      {
        "name": "Dark sunglasses",
        "category": "accessory",
        "image": "/samples/sample-one-piece-4.png",
        "heels": null,
        "sleeveless": null,
        "accessoryRole": "eyewear"
      },
      {
        "name": "Silver watch",
        "category": "accessory",
        "image": "/samples/sample-one-piece-5.png",
        "heels": null,
        "sleeveless": null,
        "accessoryRole": "watch"
      },
      {
        "name": "Oval pendant necklace",
        "category": "accessory",
        "image": "/samples/sample-one-piece-6.png",
        "heels": null,
        "sleeveless": null,
        "accessoryRole": "jewellery"
      }
    ],
    "note": "Seven saved generated previews from the first tested synthetic example.",
    "id": "synthetic-sample-1"
  },
  {
    "title": "Layered outfit",
    "source": "/samples/sample-two-source.png",
    "items": [
      {
        "name": "Ivory sleeveless top",
        "category": "top",
        "image": "/samples/sample-two-top.png",
        "heels": null,
        "sleeveless": true
      },
      {
        "name": "Indigo jeans",
        "category": "bottom",
        "image": "/samples/sample-two-jeans.png",
        "heels": null,
        "sleeveless": null
      },
      {
        "name": "Burgundy heels",
        "category": "shoes",
        "image": "/samples/sample-two-shoes.png",
        "heels": true,
        "sleeveless": null
      },
      {
        "name": "Black handbag",
        "category": "accessory",
        "image": "/samples/sample-two-bag.png",
        "heels": null,
        "sleeveless": null,
        "accessoryRole": "bag"
      }
    ],
    "note": "Four saved generated previews. The blazer did not produce a finished preview and is not included.",
    "id": "synthetic-sample-2"
  },
  {
    "id": "synthetic-sample-3",
    "title": "Blue shirt, chinos and sling pouch",
    "source": "/samples/sample-three-source.png",
    "testedSourceSha256": "790101babd0f60d2a8180267ff14216a5a4186c6e99bf2577364873b82a00410",
    "items": [
      {"name":"Blue shirt","category":"top","image":"/samples/sample-three-shirt.png","heels":null,"sleeveless":null},
      {"name":"Beige trousers","category":"bottom","image":"/samples/sample-three-trousers.png","heels":null,"sleeveless":null},
      {"name":"White sneakers","category":"shoes","image":"/samples/sample-three-sneakers.png","heels":false,"sleeveless":null},
      {"name":"Sling pouch","category":"accessory","accessoryRole":"bag","image":"/samples/sample-three-bag.png","heels":null,"sleeveless":null},
      {"name":"Black-strap watch","category":"accessory","accessoryRole":"watch","image":"/samples/sample-three-watch.png","heels":null,"sleeveless":null}
    ],
    "note": "Five saved previews. The watch strap was corrected separately after the original preview changed its colour. No new processing when loaded."
  },
{
  "id": "synthetic-sample-4",
  "title": "Burgundy polo, tailored trousers and loafers",
  "source": "/samples/sample-four-source.png",
  "testedSourceSha256": "d5b20c06c9e9dc68ac6cbd62168376904eb6e2732b2ff010a35b34ce9aec8fca",
  "items": [
    {
      "name": "Burgundy polo",
      "category": "top",
      "image": "/samples/sample-four-polo.png",
      "heels": null,
      "sleeveless": false
    },
    {
      "name": "Charcoal tailored trousers",
      "category": "bottom",
      "image": "/samples/sample-four-trousers.png",
      "heels": null,
      "sleeveless": null
    },
    {
      "name": "Brown loafers",
      "category": "shoes",
      "image": "/samples/sample-four-loafers.png",
      "heels": false,
      "sleeveless": null
    },
    {
      "name": "Brown laptop bag",
      "category": "accessory",
      "image": "/samples/sample-four-bag.png",
      "heels": null,
      "sleeveless": null,
      "accessoryRole": "bag"
    },
    {
      "name": "Brown belt",
      "category": "accessory",
      "image": "/samples/sample-four-belt.png",
      "heels": null,
      "sleeveless": null,
      "accessoryRole": "other"
    },
    {
      "name": "Clear eyeglasses",
      "category": "accessory",
      "image": "/samples/sample-four-eyeglasses.png",
      "heels": null,
      "sleeveless": null,
      "accessoryRole": "eyewear"
    }
  ],
  "note": "Six saved generated previews from the tested synthetic outfit. The incomplete watch is omitted. No new processing when loaded."
}
];
