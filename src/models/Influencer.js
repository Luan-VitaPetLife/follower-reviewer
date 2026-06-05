const mongoose = require('mongoose');

const influencerSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    followers: { type: Number, default: 0 },
    bio: { type: String },
    contacts: {
        emails: [{ type: String }],
        phones: [{ type: String }],
        links: [{ type: String }]
    },
    status: { type: String, default: 'unverified' }
}, { timestamps: true });

module.exports = mongoose.models.Influencer || mongoose.model('Influencer', influencerSchema);