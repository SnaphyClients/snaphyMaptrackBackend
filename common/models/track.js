module.exports = function(Track) {
    Track.validatesUniquenessOf('uniqueCode');
    Track.validatesUniquenessOf('locationId');
};
