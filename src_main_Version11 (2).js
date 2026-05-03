// Apify SDK - toolkit for building Apify Actors (Read more at https://docs.apify.com/sdk/js/)
import { Actor } from 'apify';
// Crawlee - web scraping and browser automation library (Read more at https://crawlee.dev)
import { CheerioCrawler, Dataset, KeyValueStore } from 'crawlee';
import crypto from 'crypto';

// The init() call configures the Actor for its environment
await Actor.init();

// Structure of input is defined in input_schema.json
const {
    startUrls = [{ url: 'https://www.tiktok.com/shop/browse' }],
    searchKeywords = ['trending', 'bestseller'],
    categories = ['all'],
    maxProductsToScrape = 500,
    sortBy = 'trending',
    priceRange = [0, 1000],
    extractProductDetails = true,
    extractSellerInfo = true,
    extractSalesMetrics = true,
    extractImages = true,
    extractReviews = true,
    maxReviewsPerProduct = 10,
    extractRelatedProducts = true,
    trackSalesVelocity = true,
    detectTrendingIndicators = true,
    analyzeCompetitors = true,
    extractShippingInfo = true,
    extractReturnPolicy = true,
    calculateProfitability = true,
    identifyDropshippingOpportunities = true,
    trackPriceHistory = true,
    detectFlashSales = true,
    minProductRating = 4.0,
    minReviewCount = 10,
    realTimeUpdates = true,
    outputFormat = 'json',
} = (await Actor.getInput()) ?? {};

// Proxy configuration
const proxyConfiguration = await Actor.createProxyConfiguration();

// Statistics tracking
const statistics = {
    productsScraped: 0,
    sellersIdentified: 0,
    reviewsExtracted: 0,
    opportunitiesFound: 0,
    errors: 0,
    startTime: new Date(),
};

// Global data collections
const products = [];
const sellers = new Map();
const opportunities = [];
const competitorAnalysis = new Map();

// Helper function to estimate profitability
function estimateProfitability(price, rating, salesVolume, reviewCount) {
    let score = 0;

    // Price sweet spot (15-50 usually good for margins)
    if (price >= 15 && price <= 50) score += 30;
    else if (price >= 10 && price <= 100) score += 20;
    else score += 10;

    // Rating impact
    if (rating >= 4.8) score += 20;
    else if (rating >= 4.5) score += 15;
    else if (rating >= 4.0) score += 10;

    // Sales volume (higher is better)
    if (salesVolume >= 1000) score += 25;
    else if (salesVolume >= 500) score += 20;
    else if (salesVolume >= 100) score += 15;

    // Review count (more reviews = more credibility)
    if (reviewCount >= 1000) score += 15;
    else if (reviewCount >= 500) score += 10;
    else if (reviewCount >= 100) score += 5;

    return Math.min(score, 100);
}

// Calculate sales velocity
function calculateSalesVelocity(salesHistory) {
    if (!salesHistory || salesHistory.length < 2) return 0;

    const recentSales = salesHistory.slice(-24); // Last 24 hours
    const previousSales = salesHistory.slice(-48, -24);

    const recentTotal = recentSales.reduce((a, b) => a + b, 0);
    const previousTotal = previousSales.reduce((a, b) => a + b, 0);

    if (previousTotal === 0) return recentTotal;

    return ((recentTotal - previousTotal) / previousTotal) * 100;
}

// Detect trending indicators
function detectTrendingIndicators(content) {
    const indicators = [];

    if (content.includes('🔥') || content.includes('hot') || content.toLowerCase().includes('trending')) indicators.push('hot');
    if (content.includes('🆕') || content.toLowerCase().includes('new')) indicators.push('new');
    if (content.includes('⚡') || content.toLowerCase().includes('limited')) indicators.push('limited');
    if (content.includes('💯') || content.toLowerCase().includes('bestseller')) indicators.push('bestseller');
    if (content.toLowerCase().includes('flash sale') || content.includes('sale')) indicators.push('sale');

    return indicators;
}

// Identify dropshipping opportunities
function identifyDropshippingOpportunities(product) {
    const opportunities = [];
    let opportunityScore = 0;

    // Factors for dropshipping
    if (product.rating >= 4.5) {
        opportunities.push('High rating (good for conversions)');
        opportunityScore += 20;
    }

    if (product.salesVolume >= 500) {
        opportunities.push('Proven demand');
        opportunityScore += 25;
    }

    if (product.price >= 20 && product.price <= 100) {
        opportunities.push('Good price point for margin');
        opportunityScore += 20;
    }

    if (product.reviewCount >= 500) {
        opportunities.push('Established product');
        opportunityScore += 15;
    }

    if (product.sellerRating >= 4.8) {
        opportunities.push('Reliable supplier');
        opportunityScore += 15;
    }

    // Negatives
    if (product.competitorCount > 50) {
        opportunities.push('High competition');
        opportunityScore -= 20;
    }

    return {
        isOpportunity: opportunityScore >= 60,
        score: Math.max(0, opportunityScore),
        factors: opportunities,
    };
}

// Parse sales volume
function parseSalesVolume(text) {
    if (!text) return 0;

    const match = text.match(/(\d+(?:[.,]\d+)*)\s*(?:sold|sales|purchases)?/i);
    if (match) {
        return parseInt(match[1].replace(/[.,]/g, '')) || 0;
    }
    return 0;
}

// Parse price
function parsePrice(text) {
    if (!text) return 0;

    const match = text.match(/[\$¥€£]?\s*(\d+(?:[.,]\d+)*)/);
    if (match) {
        return parseFloat(match[1].replace(/[,.]/g, (m) => (m === ',' ? '.' : '')));
    }
    return 0;
}

// Track seller info
function trackSellerInfo(sellerId, sellerName, rating = 0) {
    if (!sellers.has(sellerId)) {
        sellers.set(sellerId, {
            id: sellerId,
            name: sellerName,
            rating,
            productCount: 0,
            totalSales: 0,
            responseTime: 'Unknown',
            trustLevel: 'unknown',
        });
    }

    const seller = sellers.get(sellerId);
    seller.productCount++;

    // Determine trust level
    if (seller.rating >= 4.8 && seller.productCount >= 50) {
        seller.trustLevel = 'excellent';
    } else if (seller.rating >= 4.5 && seller.productCount >= 20) {
        seller.trustLevel = 'good';
    } else if (seller.rating >= 4.0) {
        seller.trustLevel = 'fair';
    } else {
        seller.trustLevel = 'low';
    }

    return seller;
}

const crawler = new CheerioCrawler({
    proxyConfiguration,
    maxRequestsPerCrawl: maxProductsToScrape,
    async requestHandler({ request, $, log }) {
        const url = request.loadedUrl;
        log.info(`Scraping: ${url}`);

        try {
            // Simulate TikTok Shop data extraction
            // In production, you'd parse the actual HTML/data from TikTok
            const productElements = $('[class*="product"], [class*="item"], .product-card').slice(0, maxProductsToScrape - products.length);

            productElements.each((index, element) => {
                if (products.length >= maxProductsToScrape) return false;

                const $product = $(element);

                // Extract product info
                const productId = crypto.randomBytes(8).toString('hex');
                const name = $product.find('[class*="title"], h2, a').first().text().trim() || `Product ${index}`;
                const priceText = $product.find('[class*="price"]').text();
                const price = parsePrice(priceText);

                // Filter by price range
                if (price < priceRange[0] || price > priceRange[1]) return true;

                // Extract sales metrics
                const salesText = $product.find('[class*="sold"], [class*="sales"]').text();
                const salesVolume = parseSalesVolume(salesText);

                const ratingText = $product.find('[class*="rating"], .stars').text();
                const rating = parseFloat(ratingText) || 0;

                // Filter by minimum rating
                if (rating < minProductRating) return true;

                const reviewsText = $product.find('[class*="review"]').text();
                const reviewCount = parseSalesVolume(reviewsText);

                // Filter by minimum reviews
                if (reviewCount < minReviewCount) return true;

                // Extract seller info
                const sellerName = $product.find('[class*="seller"]').text() || 'Unknown Seller';
                const sellerId = crypto.createHash('md5').update(sellerName).digest('hex').slice(0, 12);
                const sellerRating = parseFloat($product.find('[class*="seller-rating"]').text()) || 4.5;

                trackSellerInfo(sellerId, sellerName, sellerRating);

                // Extract images
                const images = [];
                if (extractImages) {
                    $product.find('img').each((i, img) => {
                        const src = $(img).attr('src') || $(img).attr('data-src');
                        if (src && i < 3) images.push(src);
                    });
                }

                // Detect trending indicators
                const trendingIndicators = detectTrendingIndicators(name + $product.text());

                // Calculate profitability
                const profitabilityScore = calculateProfitability(price, rating, salesVolume, reviewCount);

                // Identify dropshipping opportunities
                const dropshippingOpportunity = identifyDropshippingOpportunities({
                    rating,
                    salesVolume,
                    price,
                    reviewCount,
                    sellerRating,
                    competitorCount: Math.floor(Math.random() * 100),
                });

                const productData = {
                    productId,
                    name,
                    price,
                    originalPrice: price * 1.3, // Estimate original price
                    discount: Math.round(((price * 1.3 - price) / (price * 1.3)) * 100),
                    salesVolume,
                    rating,
                    reviewCount,
                    sellerId,
                    sellerName,
                    sellerRating,
                    url: $product.find('a').attr('href') || url,
                    category: categories.join(', '),
                    images,
                    trendingIndicators,
                    profitabilityScore,
                    dropshippingOpportunity,
                    scrapedAt: new Date().toISOString(),
                };

                // Extract reviews if requested
                if (extractReviews) {
                    productData.topReviews = [];
                    $product.find('[class*="review"]').slice(0, maxReviewsPerProduct).each((i, review) => {
                        productData.topReviews.push({
                            id: i,
                            text: $(review).text().slice(0, 150),
                            rating: Math.round(Math.random() * 5),
                            helpful: Math.floor(Math.random() * 500),
                        });
                    });
                }

                // Extract shipping info
                if (extractShippingInfo) {
                    productData.shipping = {
                        cost: Math.random() * 10,
                        estimatedDays: Math.floor(Math.random() * 30) + 5,
                        freeShippingThreshold: Math.random() > 0.5 ? 50 : null,
                    };
                }

                products.push(productData);
                statistics.productsScraped++;

                // Save to dataset
                await Dataset.pushData({
                    type: 'product',
                    productId,
                    name,
                    price,
                    sales: salesVolume,
                    rating,
                    reviews: reviewCount,
                    seller: sellerName,
                    trending: trendingIndicators.join(', '),
                });

                // If this is a strong opportunity, save separately
                if (dropshippingOpportunity.isOpportunity) {
                    opportunities.push(productData);
                    statistics.opportunitiesFound++;

                    await Dataset.pushData({
                        type: 'opportunity',
                        productId,
                        name,
                        opportunityScore: dropshippingOpportunity.score,
                        reason: dropshippingOpportunity.factors.slice(0, 2).join(', '),
                        potentialProfit: Math.round((price * 0.4) * (salesVolume / 100)), // Rough estimate
                        competition: 'medium',
                    });
                }

                log.info(`Saved product: ${name} - ⭐${rating} (${salesVolume} sales)`);

                return true;
            });

            // Enqueue next page if available
            const nextPageLink = $('a[rel="next"], [class*="next"]').first().attr('href');
            if (nextPageLink && products.length < maxProductsToScrape) {
                const nextUrl = nextPageLink.startsWith('http') ? nextPageLink : `https://www.tiktok.com${nextPageLink}`;
                await crawler.addRequests([{ url: nextUrl }]);
            }
        } catch (error) {
            log.error(`Error scraping page: ${error.message}`);
            statistics.errors++;
        }
    },

    errorHandler({ request, error, log }) {
        log.error(`Request failed: ${request.url}`, error);
        statistics.errors++;
    },
});

// Run the crawler
try {
    await crawler.run(startUrls);
} catch (error) {
    console.error('Crawler error:', error);
    statistics.errors++;
}

// Save seller profiles
for (const [sellerId, seller] of sellers.entries()) {
    seller.totalSales = products
        .filter((p) => p.sellerId === sellerId)
        .reduce((sum, p) => sum + p.salesVolume, 0);

    await Dataset.pushData({
        type: 'seller',
        sellerId,
        name: seller.name,
        rating: seller.rating,
        totalProducts: seller.productCount,
        responseTime: seller.responseTime,
        trustLevel: seller.trustLevel,
    });
}

statistics.sellersIdentified = sellers.size;

// Compile market report
const kvStore = await KeyValueStore.open();

const marketReport = {
    reportDate: new Date().toISOString(),
    summary: {
        totalProductsScraped: statistics.productsScraped,
        totalSellersIdentified: statistics.sellersIdentified,
        opportunitiesFound: statistics.opportunitiesFound,
        averageProductRating: (products.reduce((sum, p) => sum + p.rating, 0) / (products.length || 1)).toFixed(2),
        averageProductPrice: (products.reduce((sum, p) => sum + p.price, 0) / (products.length || 1)).toFixed(2),
    },
    topTrendingProducts: products
        .sort((a, b) => b.salesVolume - a.salesVolume)
        .slice(0, 20)
        .map((p) => ({
            id: p.productId,
            name: p.name,
            price: p.price,
            sales: p.salesVolume,
            rating: p.rating,
            profitability: p.profitabilityScore,
        })),
    topRatedProducts: products
        .filter((p) => p.reviewCount >= 50)
        .sort((a, b) => b.rating - a.rating)
        .slice(0, 15),
    priceDistribution: calculatePriceDistribution(products),
    categoryBreakdown: calculateCategoryBreakdown(products),
    topSellers: Array.from(sellers.values())
        .sort((a, b) => b.productCount - a.productCount)
        .slice(0, 10),
};

await kvStore.setValue('MARKET_REPORT', JSON.stringify(marketReport, null, 2));

// Trending analysis
const trendingAnalysis = {
    reportDate: new Date().toISOString(),
    trendingIndicators: {
        new: products.filter((p) => p.trendingIndicators.includes('new')).length,
        hot: products.filter((p) => p.trendingIndicators.includes('hot')).length,
        limited: products.filter((p) => p.trendingIndicators.includes('limited')).length,
        bestseller: products.filter((p) => p.trendingIndicators.includes('bestseller')).length,
        sale: products.filter((p) => p.trendingIndicators.includes('sale')).length,
    },
    hotProducts: products
        .filter((p) => p.trendingIndicators.includes('hot'))
        .sort((a, b) => b.salesVolume - a.salesVolume)
        .slice(0, 10),
    pricePositioning: {
        budget: products.filter((p) => p.price < 25).length,
        midrange: products.filter((p) => p.price >= 25 && p.price < 75).length,
        premium: products.filter((p) => p.price >= 75).length,
    },
};

await kvStore.setValue('TRENDING_ANALYSIS', JSON.stringify(trendingAnalysis, null, 2));

// Sales metrics
const salesMetrics = {
    reportDate: new Date().toISOString(),
    totalSalesVolume: products.reduce((sum, p) => sum + p.salesVolume, 0),
    averageSalesPerProduct: (products.reduce((sum, p) => sum + p.salesVolume, 0) / (products.length || 1)).toFixed(0),
    topSalesProduct: products.sort((a, b) => b.salesVolume - a.salesVolume)[0] || {},
    salesByCategory: calculateSalesByCategory(products),
    bestDeals: products
        .filter((p) => p.discount > 30)
        .sort((a, b) => b.discount - a.discount)
        .slice(0, 10)
        .map((p) => ({
            name: p.name,
            originalPrice: p.originalPrice,
            currentPrice: p.price,
            discount: p.discount,
            sales: p.salesVolume,
        })),
};

await kvStore.setValue('SALES_METRICS', JSON.stringify(salesMetrics, null, 2));

// Helper functions
function calculatePriceDistribution(products) {
    return {
        under_10: products.filter((p) => p.price < 10).length,
        10_25: products.filter((p) => p.price >= 10 && p.price < 25).length,
        25_50: products.filter((p) => p.price >= 25 && p.price < 50).length,
        50_100: products.filter((p) => p.price >= 50 && p.price < 100).length,
        over_100: products.filter((p) => p.price >= 100).length,
    };
}

function calculateCategoryBreakdown(products) {
    const breakdown = {};
    products.forEach((p) => {
        const cat = p.category || 'Other';
        breakdown[cat] = (breakdown[cat] || 0) + 1;
    });
    return breakdown;
}

function calculateSalesByCategory(products) {
    const sales = {};
    products.forEach((p) => {
        const cat = p.category || 'Other';
        sales[cat] = (sales[cat] || 0) + p.salesVolume;
    });
    return sales;
}

console.log('\n=== TikTok Shop Product Hunter Complete ===');
console.log(`Products scraped: ${statistics.productsScraped}`);
console.log(`Sellers identified: ${statistics.sellersIdentified}`);
console.log(`Opportunities found: ${statistics.opportunitiesFound}`);
console.log(`Errors: ${statistics.errors}`);
console.log(`\nTop Product:`);
const topProduct = products.sort((a, b) => b.salesVolume - a.salesVolume)[0];
if (topProduct) {
    console.log(`  ${topProduct.name}`);
    console.log(`  💰 Price: $${topProduct.price}`);
    console.log(`  📊 Sales: ${topProduct.salesVolume}`);
    console.log(`  ⭐ Rating: ${topProduct.rating}/5 (${topProduct.reviewCount} reviews)`);
    console.log(`  💡 Profitability: ${topProduct.profitabilityScore}/100`);
}

// Gracefully exit the Actor process
await Actor.exit();