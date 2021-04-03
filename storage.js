const path = require('path')
const fs = require('fs')
const FILE_STORAGE = process.env.LOCAL_CONFIGURATION_STORAGE || '.storage'
if (!fs.existsSync(path.resolve(__dirname, FILE_STORAGE))) {
    fs.mkdirSync(path.resolve(__dirname, FILE_STORAGE))
}
module.exports = {
    // the promise returned from sync function
    // set item with the key
    setItem: (key, value) => {
        fs.writeFileSync(path.resolve(__dirname, FILE_STORAGE, `${key}`), value)
    },
    // get item with the key
    getItem: (key) => {
        if (fs.existsSync(path.resolve(__dirname, FILE_STORAGE, `${key}`))) {
            return `${fs.readFileSync(path.resolve(__dirname, FILE_STORAGE, `${key}`))}`
        } else {
            return null
        }
    },
    // remove item with the key
    removeItem: (key) => {
        if (fs.existsSync(path.resolve(__dirname, FILE_STORAGE, `${key}`))) {
            fs.unlinkSync(path.resolve(__dirname, FILE_STORAGE, `${key}`))
        }
    },
    // clear out the storage
    clear: () => {
        fs.rmdirSync(path.resolve(__dirname, FILE_STORAGE))
    },
    // If the storage operations are async(i.e AsyncStorage)
    // Then you need to sync those items into the memory in this method
    sync: () => { }
}