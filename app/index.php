<?php
/**
 * DSK Credit API – обработка на заявки за покупка на изплащане
 */

// Изпълняване на всички проверки за сигурност
require_once __DIR__ . '/security.php';
perform_security_checks();

// Започване на output buffering за да избегнем проблеми с headers
if (!ob_get_level()) {
    ob_start();
}

// Премахване на всички съществуващи CSP и X-Frame-Options headers
header_remove('Content-Security-Policy');
header_remove('X-Frame-Options');
header_remove('X-Frame-Options-SAMEORIGIN');

// Разрешаване на вграждане в iframe от Shopify магазини и всички домейни
// Важно: Headers трябва да се изпратят ПРЕДИ какъвто и да е изход
header("Content-Security-Policy: frame-ancestors *", true);
header("X-Frame-Options: ALLOWALL", true);

// Алтернативно за production (по-строго):
// header("Content-Security-Policy: frame-ancestors 'self' https://*.myshopify.com https://*.shopifycdn.com", true);

// Получаване на POST данните (след всички проверки)
$product_id = $_POST['product_id'] ?? '';
$product_title = $_POST['product_title'] ?? '';
$product_title_escaped = htmlspecialchars($product_title);
$product_price = $_POST['product_price'] ?? '';
$product_variant_id = $_POST['product_variant_id'] ?? '';
$shop_domain = $_POST['shop_domain'] ?? '';
$shop_permanent_domain = $_POST['shop_permanent_domain'] ?? '';
$cid = $_POST['cid'] ?? '';

// Твоята логика за стъпков процес...
echo "DSK Credit API";
echo "<br>Product ID: " . htmlspecialchars($product_id);
echo "<br>Product Title: " . htmlspecialchars($product_title);
echo "<br>Product Price: " . htmlspecialchars($product_price);
echo "<br>Product Title Escaped: " . $product_title_escaped;
echo "<br>Product Variant ID: " . $product_variant_id;
echo "<br>Shop Domain: " . $shop_domain;
echo "<br>CID: " . $cid;