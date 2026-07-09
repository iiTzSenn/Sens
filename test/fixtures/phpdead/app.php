<?php

namespace App;

use App\Models\User;
use App\Models\Registry;

// Instantiate a class with `new` — keeps User (and its parent/interface) alive.
$user = new User("alice");

// Method call via `$obj->method()` — keeps getName alive.
echo $user->getName();

// Static method call via `Class::method()` — keeps Registry::register alive.
Registry::register($user);

// Call a top-level function — keeps formatName alive.
echo formatName("bob");

// A top-level function that USES formatName.
function formatName(string $s): string
{
    return ucfirst($s);
}

// A top-level function nobody ever calls — the LOW dead-code candidate.
function neverCalled(): string
{
    return "dead";
}
