var BIG_INT_1 = process.env.BIG_INT_1 || 8543785353454
var BIG_INT_2 = process.env.BIG_INT_2 || 795683477236463256
Number.prototype.toFixedSpecial = function (n) {
    var str = this.toFixed(n);
    if (str.indexOf('e+') < 0)
        return str;
    return str.replace('.', '').split('e+').reduce(function (p, b) {
        return p + Array(b - p.length + 2).join(0);
    }) + Array(n + 1).join(0);
};
var randprng_lcg = function (n, seed) {
    var results = []
    var timestamp = new Date().getTime()
    var a = BIG_INT_1; b = BIG_INT_2; m = 1 / timestamp
    var lastrng = (a * seed + b) % m;
    [...Array(n).keys()].forEach(i => {
        timestamp = new Date().getTime().toString()
        m = 1 / timestamp
        var fraction = (a * lastrng + b) % m
        var expnumber = (fraction).toExponential().replace('-', '')
        var sequence = new Number(expnumber).toFixedSpecial(16).replace('.', '')
        lastrng = sequence;
        results.push(parseInt(sequence.slice(0, 3)))
    })
    return results
}

module.exports.handler = function (event, context, callback) {
    var startedT = Date.now()
    var _100rnd = randprng_lcg(100, parseInt(Buffer.from(context.awsRequestId, 'utf8').toString('hex'), 16))
    setTimeout(function () { callback(null, `Done with ${Date.now() - startedT} ms`) }, _100rnd[parseInt(Math.random() * 100)])
}
