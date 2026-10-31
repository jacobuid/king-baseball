// IndexedDB keeps audio files and the roster together, scoped to the signed-in user.
export function teamStorage(userId, team) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('king-baseball', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('teams')
    request.onerror = () => reject(request.error)
    request.onblocked = () => reject(new Error('Close other King Baseball tabs and try again.'))
    request.onsuccess = () => {
      const db = request.result
      const transaction = db.transaction('teams', team === undefined ? 'readonly' : 'readwrite')
      const store = transaction.objectStore('teams')
      const operation = team === undefined ? store.get(userId) : store.put(team, userId)
      transaction.oncomplete = () => { db.close(); resolve(operation.result) }
      transaction.onerror = transaction.onabort = () => { db.close(); reject(transaction.error || new Error('Unable to save team')) }
    }
  })
}
