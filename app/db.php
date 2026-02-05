<?php
/**
 * Database connection и помощни функции за работа с PostgreSQL
 */

// Debug режим - задай на false за production
define('DB_DEBUG', true);
defined('PLATFORM_SHOPIFY') or define('PLATFORM_SHOPIFY', 2);

/**
 * Чете конфигурацията от configdsk.ini файла
 * @return array Масив с данни за базата данни или false при грешка
 */
function get_db_config(): array|false
{
    $configFile = __DIR__ . '/../../configdsk.ini';
    
    if (!file_exists($configFile)) {
        return false;
    }
    
    $config = parse_ini_file($configFile, true);
    
    if (!isset($config['database'])) {
        return false;
    }
    
    return $config['database'];
}

/**
 * Създава връзка с PostgreSQL базата данни
 * @return PDO|false PDO обект или false при грешка
 */
function get_db_connection(): PDO|false
{
    static $pdo = null;
    
    // Използваме статична променлива за да не създаваме нова връзка при всяко извикване
    if ($pdo !== null) {
        return $pdo;
    }
    
    $config = get_db_config();
    if ($config === false) {
        if (DB_DEBUG) {
            http_response_code(500);
            exit('Database config file not found or invalid');
        }
        return false;
    }
    
    $host = $config['host'] ?? 'localhost';
    $port = $config['port'] ?? '5432';
    $dbname = $config['dbname'] ?? '';
    $user = $config['user'] ?? '';
    $password = $config['password'] ?? '';
    
    if (empty($dbname) || empty($user)) {
        if (DB_DEBUG) {
            http_response_code(500);
            exit('Database config incomplete (missing dbname or user)');
        }
        return false;
    }
    
    try {
        $dsn = "pgsql:host={$host};port={$port};dbname={$dbname}";
        $pdo = new PDO($dsn, $user, $password, [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES => false, // Използваме истински prepared statements
        ]);
        
        return $pdo;
    } catch (PDOException $e) {
        if (DB_DEBUG) {
            http_response_code(500);
            exit('Database connection error: ' . htmlspecialchars($e->getMessage()));
        }
        return false;
    }
}

/**
 * Проверява дали CID и домейн са валидни в базата данни
 * @param string $cid CID от заявката
 * @param string $shopDomain Домейн на магазина (може да е custom или permanent)
 * @param string $shopPermanentDomain Permanent домейн на магазина
 * @return array|false Масив с данни от таблицата или false ако не е намерен/валиден
 */
function validate_shop_in_db(string $cid, string $shopDomain, string $shopPermanentDomain): array|false
{
    $pdo = get_db_connection();
    if ($pdo === false) {
        if (DB_DEBUG) {
            http_response_code(500);
            exit('Database connection failed');
        }
        return false;
    }
    
    try {
        // Подготвяме заявката с prepared statement за сигурност
        $sql = "SELECT name, unicid, type, dsk_status 
                FROM calculators 
                WHERE unicid = :cid 
                AND type = :platform 
                AND dsk_status = 1 
                LIMIT 1";
        
        $stmt = $pdo->prepare($sql);
        $stmt->execute([':cid' => $cid, ':platform' => PLATFORM_SHOPIFY]);
        $result = $stmt->fetch();
        
        if ($result === false) {
            if (DB_DEBUG) {
                http_response_code(403);
                exit('Shop not found in database (CID: ' . htmlspecialchars($cid) . ', Domain: ' . htmlspecialchars($shopDomain) . ')');
            }
            return false;
        }
        
        // Проверяваме дали домейнът от базата съвпада с домейна от заявката
        $dbDomain = $result['name'] ?? '';
        
        // Премахваме https:// от началото ако има и нормализираме
        $dbDomainClean = preg_replace('#^https?://#', '', strtolower(trim($dbDomain)));
        $dbDomainClean = rtrim($dbDomainClean, '/'); // Премахваме trailing slash
        
        $shopDomainClean = preg_replace('#^https?://#', '', strtolower(trim($shopDomain)));
        $shopDomainClean = rtrim($shopDomainClean, '/');
        
        $shopPermanentDomainClean = preg_replace('#^https?://#', '', strtolower(trim($shopPermanentDomain)));
        $shopPermanentDomainClean = rtrim($shopPermanentDomainClean, '/');
        
        // Проверяваме дали поне един от домейните съвпада
        // Взимаме предвид различни варианти:
        // - Точно съвпадение
        // - Custom domain vs permanent domain
        // - С или без .myshopify.com суфикс
        $domainMatch = false;
        
        // Директно съвпадение
        if ($dbDomainClean === $shopDomainClean || $dbDomainClean === $shopPermanentDomainClean) {
            $domainMatch = true;
        }
        
        // Проверка за .myshopify.com варианти
        if (!$domainMatch) {
            $dbDomainBase = preg_replace('/\.myshopify\.com$/', '', $dbDomainClean);
            $shopDomainBase = preg_replace('/\.myshopify\.com$/', '', $shopDomainClean);
            $shopPermanentDomainBase = preg_replace('/\.myshopify\.com$/', '', $shopPermanentDomainClean);
            
            if ($dbDomainBase === $shopDomainBase || $dbDomainBase === $shopPermanentDomainBase) {
                $domainMatch = true;
            }
        }
        
        // Проверка ако DB има .myshopify.com, а заявката има само base
        if (!$domainMatch) {
            if (strpos($dbDomainClean, '.myshopify.com') !== false) {
                $dbDomainBase = preg_replace('/\.myshopify\.com$/', '', $dbDomainClean);
                if ($dbDomainBase === $shopDomainClean || $dbDomainBase === $shopPermanentDomainClean) {
                    $domainMatch = true;
                }
            }
        }
        
        if (!$domainMatch) {
            if (DB_DEBUG) {
                http_response_code(403);
                exit('Domain mismatch. DB: ' . htmlspecialchars($dbDomainClean) . 
                     ', Request: ' . htmlspecialchars($shopDomainClean) . 
                     ' / ' . htmlspecialchars($shopPermanentDomainClean));
            }
            return false;
        }
        
        return $result;
    } catch (PDOException $e) {
        if (DB_DEBUG) {
            http_response_code(500);
            exit('Database query error: ' . htmlspecialchars($e->getMessage()));
        }
        return false;
    }
}
