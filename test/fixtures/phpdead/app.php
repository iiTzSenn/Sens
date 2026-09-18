<?php

namespace App;

use App\Models\User;
use App\Models\Registry;

$user = new User("alice");

echo $user->getName();

Registry::register($user);

echo formatName("bob");

function formatName(string $s): string
{
    return ucfirst($s);
}

function neverCalled(): string
{
    return "dead";
}
