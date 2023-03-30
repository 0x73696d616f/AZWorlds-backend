const { ethers, JsonRpcProvider } = require('ethers');
const ABI = require("./contracts/CharacterSale.json");
require("dotenv").config();
const { createClient } = require('@supabase/supabase-js')
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));


const supabaseUrl = 'https://wylvkxjtrqxesqarblyf.supabase.co'
const supabaseKey = process.env.SUPABASE_KEY
const supabase = createClient(supabaseUrl, supabaseKey)

async function onCharacterSale() {
    const characterSaleAddress = "0x7A826212b8AB639bfC02ae3af4d4Eb8EbE1cDc5B";
    const provider = new JsonRpcProvider(process.env.RPC_URL_SEPOLIA);

    const contract = new ethers.Contract(characterSaleAddress, ABI, provider);

    contract.on("CharacterBought", async (buyer, charId, price, tokenURI) => {
        if (buyer == null) return;
        try {
            const cid = tokenURI.slice(7, tokenURI.length-14);
            const metadataUrl = `https://ipfs.io/ipfs/${cid}/metadata.json`;
            const metadata = await fetch(metadataUrl);
            const metadataJson = await metadata.json();
            console.log(metadataJson);
            const { data, error } = await supabase
                .from('Character')
                .insert([
                    {
                        charId: charId.toString(),
                        level: "1",
                        power: "1",
                        buyPrice: price.toString(),
                        equippedItems: [],
                        equippedGold: "0",
                        url: tokenURI,
                        owner: buyer.toString(),
                        img: metadataJson.image,
                    }
                ])

            console.log(metadata);
            console.log("Log CharacterBought");
            console.log(data);
            console.log(error);
        } catch (error) {
            console.log(error);
        }
    });
}


onCharacterSale();
