package com.hypercolor

import java.util.concurrent.ConcurrentHashMap

/** One-shot table: [take] removes the value so a second consumer cannot reuse it. */
internal class AuthFlowSlots<T> {
    private val values = ConcurrentHashMap<String, T>()

    fun put(id: String, value: T) {
        values[id] = value
    }

    fun peek(id: String): T? = values[id]

    fun take(id: String): T? = values.remove(id)

    fun clear() {
        values.clear()
    }
}
