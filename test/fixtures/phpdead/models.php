<?php

namespace App\Models;

// Base class — kept alive because User `extends` it.
class Person
{
    protected string $name = "";
}

// Interface — kept alive because User `implements` it.
interface Named
{
    public function getName(): string;
}

// Instantiated with `new` in app.php, so the class is alive.
class User extends Person implements Named
{
    public function __construct(string $name)
    {
        $this->name = $name;
    }

    // Called via `$obj->getName()` in app.php — alive.
    public function getName(): string
    {
        return $this->normalize($this->name);
    }

    // Called via `$this->normalize()` from getName — alive.
    private function normalize(string $s): string
    {
        return trim($s);
    }

    // Never referenced anywhere — a genuine dead private method (LOW candidate).
    private function unusedSecret(): string
    {
        return "nobody calls me";
    }
}

class Registry
{
    // Called via `Registry::register()` in app.php — alive.
    public static function register(User $u): void
    {
        self::log($u);
    }

    // Called via `self::log()` from register — alive.
    private static function log(User $u): void
    {
        error_log($u->getName());
    }
}
