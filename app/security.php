<?php
/**
 * Security checks – всички проверки за сигурност преди обработка на заявката
 * Този файл съдържа всички защитни механизми за намаляване на натиска върху сървъра
 */

/**
 * Изпълнява всички проверки за сигурност
 * Ако някоя проверка не мине, функцията автоматично връща HTTP отговор и спира изпълнението
 */
function perform_security_checks(): void
{
    // 1. Проверка за HTTP метод - само POST
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
        http_response_code(405);
        exit;
    }

    // 2. Проверка за HTTPS - блокирай HTTP заявки
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

    // 3. Проверка за Content-Type - приемай само валидни форми
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

    // 4. Проверка за Origin/Referer headers - задължителни за сигурност
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
    $referer = $_SERVER['HTTP_REFERER'] ?? '';

    if (empty($origin) && empty($referer)) {
        http_response_code(403);
        exit('Origin or Referer header required');
    }

    // 5. Блокиране на ботове/сканери
    if (is_bot_user_agent()) {
        http_response_code(403);
        exit('Access denied');
    }

    // 6. GeoIP проверка - блокирай всичко извън България
    require_once __DIR__ . '/geoip.php';
    $ip = get_client_ip();
    
    if (!is_ip_from_bulgaria($ip)) {
        http_response_code(403);
        exit('Access denied');
    }

    // 7. Rate limiting - проверка за прекалено много заявки
    $cidForLimit = $_POST['cid'] ?? 'no-cid';
    $ipOk = rl_check('ip_' . $ip, 30, 60); // 30 req/мин/IP
    $cidOk = rl_check('cid_' . $cidForLimit, 120, 60); // 120 req/мин/CID

    if (!$ipOk || !$cidOk) {
        http_response_code(429);
        header('Retry-After: 60');
        exit('Too many requests');
    }

    // 8. Timestamp guard - блокирай replay атаки и стари заявки
    $timestamp = isset($_POST['ts']) ? (int)$_POST['ts'] : 0;
    $currentTime = time();
    $timestampWindow = 300; // 5 минути в секунди
    
    if ($timestamp === 0 || abs($currentTime - $timestamp) > $timestampWindow) {
        http_response_code(403);
        exit('Invalid or expired timestamp');
    }

    // 9. Валидация на задължителни полета
    $cid = $_POST['cid'] ?? '';
    $shop_domain = $_POST['shop_domain'] ?? '';
    $shop_permanent_domain = $_POST['shop_permanent_domain'] ?? '';
    $product_id = $_POST['product_id'] ?? '';

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

/**
 * Файлов rate limit – брои заявки по ключ (напр. IP, CID) в рамките на прозорец
 * @param string $key Ключ за идентификация (напр. 'ip_1.2.3.4' или 'cid_ABC123')
 * @param int $limit Максимален брой заявки в прозореца
 * @param int $windowSeconds Размер на прозореца в секунди
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
