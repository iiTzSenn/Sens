package com.app

import androidx.compose.runtime.Composable

// @Composable is invoked by the Compose runtime, not by an in-project caller.
// Marked entry -> must never be flagged even though nothing here calls it.
@Composable
fun Greeting() {
}
