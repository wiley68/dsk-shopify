<?php
/**
 * DSK Credit API – обработка на заявки за покупка на изплащане
 */

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    exit;
}

// Проверка за HTTPS - блокирай HTTP заявки
$isHttps = false;
if (isset($_SERVER['HTTPS']) && strtolower($_SERVER['HTTPS']) !== 'off') {
    $isHttps = true;
} elseif (isset($_SERVER['HTTP_X_FORWARDED_PROTO']) && strtolower($_SERVER['HTTP_X_FORWARDED_PROTO']) === 'https') {
    // За load balancer/proxy който предава HTTPS чрез header
    $isHttps = true;
} elseif (isset($_SERVER['SERVER_PORT']) && $_SERVER['SERVER_PORT'] == 443) {
    // Алтернативна проверка по порт
    $isHttps = true;
}

if (!$isHttps) {
    http_response_code(403);
    exit('HTTPS required');
}

// Проверка за Content-Type - приемай само валидни форми
$contentType = $_SERVER['CONTENT_TYPE'] ?? '';
$isValidContentType = false;
if (!empty($contentType)) {
    $contentTypeLower = strtolower($contentType);
    // Проверка за application/x-www-form-urlencoded или multipart/form-data
    if (strpos($contentTypeLower, 'application/x-www-form-urlencoded') !== false ||
        strpos($contentTypeLower, 'multipart/form-data') !== false) {
        $isValidContentType = true;
    }
}

if (!$isValidContentType) {
    http_response_code(415);
    exit('Unsupported Media Type');
}

// Проверка за Origin/Referer headers - задължителни за сигурност
// Повечето ботове не изпращат тези headers правилно
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
$referer = $_SERVER['HTTP_REFERER'] ?? '';

if (empty($origin) && empty($referer)) {
    http_response_code(403);
    exit('Origin or Referer header required');
}

/**
 * Проверява дали User-Agent е известен бот/сканер
 * @return bool true ако е бот, false ако е легитимен браузър
 */
function is_bot_user_agent(): bool
{
    $ua = strtolower($_SERVER['HTTP_USER_AGENT'] ?? '');
    
    // Празен User-Agent е подозрителен
    if (empty($ua)) {
        return true;
    }
    
    // Списък с известни ботове/сканери
    $botPatterns = [
        'bot', 'crawler', 'spider', 'scraper',
        'curl', 'wget', 'python', 'java', 'perl', 'ruby',
        'go-http', 'http', 'scrapy', 'mechanize',
        'headless', 'phantom', 'selenium', 'webdriver',
        'postman', 'insomnia', 'apache-httpclient', 'okhttp',
        'libwww-perl', 'masscan', 'nmap', 'nikto',
        'sqlmap', 'dirbuster', 'gobuster', 'burp', 'zap',
        'nessus', 'openvas', 'acunetix', 'netsparker',
        'appscan', 'qualys', 'rapid7', 'metasploit',
        'havij', 'pangolin', 'sqlsus', 'sqlninja',
        'w3af', 'skipfish', 'wapiti', 'arachni',
        'lynx', 'links', 'w3m'
    ];
    
    foreach ($botPatterns as $pattern) {
        if (strpos($ua, $pattern) !== false) {
            return true;
        }
    }
    
    // Проверка за валидни браузъри (Mozilla, Chrome, Safari, Edge, Firefox)
    $validBrowsers = ['mozilla', 'chrome', 'safari', 'edge', 'firefox', 'opera', 'msie'];
    $hasValidBrowser = false;
    foreach ($validBrowsers as $browser) {
        if (strpos($ua, $browser) !== false) {
            $hasValidBrowser = true;
            break;
        }
    }
    
    // Ако няма признаци за валиден браузър, считаме за бот
    return !$hasValidBrowser;
}

// Блокиране на ботове/сканери (резервна проверка в PHP)
if (is_bot_user_agent()) {
    http_response_code(403);
    exit('Access denied');
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
$shop_permanent_domain = $_POST['shop_permanent_domain'] ?? '';
$cid = $_POST['cid'] ?? '';
$timestamp = isset($_POST['ts']) ? (int)$_POST['ts'] : 0;

// Timestamp guard - блокирай replay атаки и стари заявки
$currentTime = time();
$timestampWindow = 300; // 5 минути в секунди
if ($timestamp === 0 || abs($currentTime - $timestamp) > $timestampWindow) {
    http_response_code(403);
    exit('Invalid or expired timestamp');
}

// Валидация на задължителни полета - блокирай ако липсват
$requiredFields = [
    'cid' => $cid,
    'shop_domain' => $shop_domain,
    'shop_permanent_domain' => $shop_permanent_domain,
    'product_id' => $product_id
];

$missingFields = [];
foreach ($requiredFields as $field => $value) {
    if (empty($value)) {
        $missingFields[] = $field;
    }
}

if (!empty($missingFields)) {
    http_response_code(400);
    exit('Missing required fields: ' . implode(', ', $missingFields));
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