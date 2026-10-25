const categoryColors: Record<string, string> = {
  grocery: '#cf2738',
  'refrigerated/frozen': '#347db8',
  merchandise: '#805bb5',
  produce: '#2d9565',
  dairy: '#c99525',
  meat: '#b65d4b',
  pantry: '#d27337',
  bakery: '#986a43',
  frozen: '#258fa7',
  beverages: '#4685c4',
  household: '#705fa8',
  toiletries: '#a366b6',
  'condiments & sauces': '#c96d3d',
  'snacks & sweets': '#d6588a',
  'personal care': '#7569b7',
  vegetables: '#3a9b72',
  other: '#818995',
};

export function categoryColor(category: string): string {
  const name = category.trim().toLowerCase().replace(/\s+/g, ' ') || 'other';
  if (categoryColors[name]) return categoryColors[name];
  let hash = 0;
  for (const letter of name) hash = (hash * 31 + letter.charCodeAt(0)) >>> 0;
  return `hsl(${hash % 360} 55% 45%)`;
}
