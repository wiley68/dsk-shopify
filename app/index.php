<?php
/**
 * DSK Credit API – обработка на заявки за покупка на изплащане
 */

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    exit;
}

/**
 * Файлов rate limit – брои заявки по ключ (напр. IP, CID) в рамките на прозорец
 * @return bool true ако е под лимита, false ако е над
 */
function rl_check(string $key, int $limit, int $windowSeconds = 60): bool
{
    $dir = __DIR__ . '/ratelimit';
    if (!is_dir($dir)) {
        @mkdir($dir, 0700, true);
    }

    // безопасно име на файл
    $safeKey = preg_replace('/[^A-Za-z0-9_\-\.]/', '_', $key);
    $file = $dir . '/rl_' . $safeKey . '.txt';
    $now = time();

    $start = $now;
    $count = 0;

    $fh = @fopen($file, 'c+');
    if ($fh === false) {
        // ако не можем да отворим файла, не блокираме, но логиката може да се разшири
        return true;
    }

    if (flock($fh, LOCK_EX)) {
        $data = stream_get_contents($fh);
        if ($data) {
            [$storedStart, $storedCount] = array_pad(explode('|', trim($data), 2), 2, 0);
            $storedStart = (int)$storedStart;
            $storedCount = (int)$storedCount;
            if ($now - $storedStart < $windowSeconds) {
                $start = $storedStart;
                $count = $storedCount;
            }
        }

        $count++;

        // записваме обратно
        ftruncate($fh, 0);
        rewind($fh);
        fwrite($fh, $start . '|' . $count);
        fflush($fh);
        flock($fh, LOCK_UN);
    }
    fclose($fh);

    return $count <= $limit;
}

// Rate limit преди всякаква по-тежка логика (и преди DB)
require_once __DIR__ . '/geoip.php';

$ip = get_client_ip();
$cidForLimit = $_POST['cid'] ?? 'no-cid';

// GeoIP проверка - блокирай всичко извън България
if (!is_ip_from_bulgaria($ip)) {
    http_response_code(403);
    exit('Access denied');
}

// Примерни лимити: 30 req/мин/IP и 120 req/мин/CID
$ipOk = rl_check('ip_' . $ip, 30, 60);
$cidOk = rl_check('cid_' . $cidForLimit, 120, 60);

if (!$ipOk || !$cidOk) {
    http_response_code(429);
    header('Retry-After: 60');
    exit('Too many requests');
}

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

// Получаване на POST данните
$product_id = $_POST['product_id'] ?? '';
$product_title = $_POST['product_title'] ?? '';
$product_title_escaped = htmlspecialchars($product_title);
$product_price = $_POST['product_price'] ?? '';
$product_variant_id = $_POST['product_variant_id'] ?? '';
$shop_domain = $_POST['shop_domain'] ?? '';
$cid = $_POST['cid'] ?? '';

// Валидация
if (empty($cid) || empty($product_id)) {
    die('Липсват задължителни данни');
}

// Твоята логика за стъпков процес...
echo "DSK Credit API";
echo "<br>Product ID: " . htmlspecialchars($product_id);
echo "<br>Product Title: " . htmlspecialchars($product_title);
echo "<br>Product Price: " . htmlspecialchars($product_price);
echo "<br>Product Title Escaped: " . $product_title_escaped;
echo "<br>Product Variant ID: " . $product_variant_id;
echo "<br>Shop Domain: " . $shop_domain;
echo "<br>CID: " . $cid;