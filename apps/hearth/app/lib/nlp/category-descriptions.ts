/**
 * Rich description strings for each Hearth category.
 * Used to pre-compute embeddings for semantic category matching.
 * Each description includes the category name + synonyms + example merchants.
 */
export const CATEGORY_DESCRIPTIONS: Record<string, string> = {
  c1: 'Food - eating, meals, restaurants, groceries, cooking',
  c1a: 'Groceries - grocery store, supermarket, food shopping, Whole Foods, Trader Joes, Costco, Safeway, Kroger',
  c1b: 'Dining Out - restaurant, takeout, fast food, delivery, lunch, dinner, cafe, bistro, sushi, pizza, pho, thai, mexican',
  c1c: 'Coffee - coffee shop, cafe, latte, espresso, Starbucks, Blue Bottle, Peets, Dunkin',
  c2: 'Transport - transportation, commute, travel, getting around',
  c2a: 'Gas - gas station, fuel, petrol, gasoline, Shell, Chevron, BP, ExxonMobil',
  c2b: 'Parking - parking lot, garage, meter, valet',
  c2c: 'Public Transit - bus, subway, train, metro, BART, Muni, fare, transit pass',
  c3: 'Bills - monthly bills, recurring charges, utilities',
  c3a: 'Internet - wifi, broadband, ISP, Comcast, Xfinity, ATT, Spectrum',
  c3b: 'Phone - mobile, cell phone, T-Mobile, Verizon, ATT, wireless',
  c3c: 'Utilities - electric, water, gas, power, PGE, Con Edison, utility bill',
  c3d: 'Rent / Mortgage - rent, mortgage, housing, apartment, lease',
  c4: 'Shopping - retail, store, purchasing, buying',
  c4a: 'Amazon - Amazon, Prime, online shopping, package',
  c4b: 'Clothing - clothes, apparel, fashion, shoes, Nike, Zara, H&M, Gap',
  c5: 'Health - healthcare, medical, wellness',
  c5a: 'Pharmacy - drugstore, prescription, medicine, CVS, Walgreens, RiteAid',
  c5b: 'Gym - gym membership, fitness, workout, exercise, CrossFit, Planet Fitness',
  c6: 'Entertainment - fun, leisure, recreation',
  c6a: 'Streaming - Netflix, Spotify, Hulu, Disney+, HBO, YouTube Premium, subscription',
  c6b: 'Games - video games, gaming, Steam, PlayStation, Xbox, Nintendo',
  c7: 'Income - earnings, revenue, money received',
  c7a: 'Salary - paycheck, wages, direct deposit, biweekly pay',
  c7b: 'Freelance - freelance income, side gig, consulting, contract work, invoice',
  c8: 'Savings - savings, investment, putting money away',
}
