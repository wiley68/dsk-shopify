<?php
/**
 * GeoIP проверка – определя дали IP адрес е от България
 * Поддържа няколко метода: Cloudflare header, MaxMind GeoLite2, или външен API
 */

/**
 * Проверява дали IP адрес е от България
 * @param string $ip IP адрес за проверка
 * @return bool true ако е от България, false иначе
 */
function is_ip_from_bulgaria(string $ip): bool
{
    // 1. Проверка чрез Cloudflare header (ако сайтът е зад Cloudflare)
    if (isset($_SERVER['HTTP_CF_IPCOUNTRY'])) {
        $country = strtoupper(trim($_SERVER['HTTP_CF_IPCOUNTRY']));
        return $country === 'BG';
    }

    // 2. Проверка чрез MaxMind GeoLite2 база (ако е инсталирана)
    $geoipDb = __DIR__ . '/GeoLite2-Country.mmdb';
    if (file_exists($geoipDb) && class_exists('MaxMind\Db\Reader')) {
        try {
            $reader = new \MaxMind\Db\Reader($geoipDb);
            $record = $reader->get($ip);
            $reader->close();
            
            if (isset($record['country']['iso_code'])) {
                return strtoupper($record['country']['iso_code']) === 'BG';
            }
        } catch (Exception $e) {
            // Ако има грешка, продължаваме към следващия метод
        }
    }

    // 3. Fallback: Външен API (ipapi.co - безплатен, до 1000 req/ден)
    // За production препоръчвам MaxMind GeoLite2 за по-бърза проверка
    $apiUrl = 'https://ipapi.co/' . urlencode($ip) . '/country_code/';
    $context = stream_context_create([
        'http' => [
            'timeout' => 2, // Кратък timeout за да не забавя заявката
            'method' => 'GET',
            'header' => 'User-Agent: DSK-API/1.0'
        ]
    ]);
    
    $result = @file_get_contents($apiUrl, false, $context);
    if ($result !== false) {
        $country = strtoupper(trim($result));
        return $country === 'BG';
    }

    // 4. Ако всички методи се провалят, по подразбиране разрешаваме
    // (за да не блокираме легитимни заявки при проблеми с GeoIP услугите)
    // За по-строга защита можеш да промениш на return false;
    return true;
}

/**
 * Получава реалния IP адрес на клиента (взима предвид прокси/load balancer)
 * @return string IP адрес
 */
function get_client_ip(): string
{
    // Проверка за Cloudflare
    if (isset($_SERVER['HTTP_CF_CONNECTING_IP'])) {
        return $_SERVER['HTTP_CF_CONNECTING_IP'];
    }
    
    // Проверка за други прокси
    $headers = [
        'HTTP_X_FORWARDED_FOR',
        'HTTP_X_REAL_IP',
        'HTTP_CLIENT_IP',
        'REMOTE_ADDR'
    ];
    
    foreach ($headers as $header) {
        if (!empty($_SERVER[$header])) {
            $ip = trim(explode(',', $_SERVER[$header])[0]);
            if (filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE)) {
                return $ip;
            }
        }
    }
    
    return $_SERVER['REMOTE_ADDR'] ?? '0.0.0.0';
}
