<?php

namespace App\Models;

class Person
{
    protected string $name = "";
}

interface Named
{
    public function getName(): string;
}

class User extends Person implements Named
{
    public function __construct(string $name)
    {
        $this->name = $name;
    }

    public function getName(): string
    {
        return $this->normalize($this->name);
    }

    private function normalize(string $s): string
    {
        return trim($s);
    }

    private function unusedSecret(): string
    {
        return "nobody calls me";
    }
}

class Registry
{

    public static function register(User $u): void
    {
        self::log($u);
    }

    private static function log(User $u): void
    {
        error_log($u->getName());
    }
}
