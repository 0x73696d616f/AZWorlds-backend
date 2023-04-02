const { ethers, JsonRpcProvider } = require('ethers');
const characterSaleABI = require("./contracts/CharacterSale.json");
const itemABI = require("./contracts/Item.json");
const goldABI = require("./contracts/Gold.json");
require("dotenv").config();
const { createClient } = require('@supabase/supabase-js')
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

const supabaseUrl = 'https://wylvkxjtrqxesqarblyf.supabase.co'
const supabaseKey = process.env.SUPABASE_KEY
const supabase = createClient(supabaseUrl, supabaseKey)
const characterSaleAddress = "0x65aAc97b628AdA288b8302510A01D703968c4F6E";
const itemAddress = "0x7f4fbef63efc155816522395629cdbb155e4e212";
const goldAddress = "0x4Faf565e395a1C069a8132437D3b70BeF1A0d999";

async function onContractEvents(rpcUrl, chain, chainName) {
    const provider = new JsonRpcProvider(rpcUrl);
    let contract = new ethers.Contract(characterSaleAddress, characterSaleABI, provider);

    contract.on("CharacterBought", async (buyer, charId, price, tokenURI) => {
        try {
            createCharacter(chainName, buyer, charId, price, tokenURI);
        } catch (error) {
            console.log(error);
        }
    });

    contract.on("ItemsEquipped", async (charId, itemIds) => {
        try {
            updateItemsEquipped(charId, itemIds);
        } catch (error) {
            console.log(error);
        }
    });
    contract.on("GoldCarried", async (charId, amount) => {
        try {
            updateGoldCarried(charId, amount);
        } catch (error) {
            console.log(error);
        }
    });
    contract.on("GoldDropped", async (charId, amount) => { 
        try {
            updateGoldCarried(charId, -amount);
        } catch (error) {
            console.log(error);
        }
    });

    contract.on("Transfer", async (from, to, charId) => {
        try {
            updateCharId(chain, from, to, charId);
        } catch (error) {
            console.log(error);
        }
    });

    contract.on("CharacterLevelUp", async (charId, level) => {
        try {
            updateLevel(charId, level);
        } catch (error) {
            console.log(error);
        }
    });

    contract = new ethers.Contract(itemAddress, itemABI, provider);

    contract.on("TransferSingle", async (operator, from, to, id, amount) => {
        try {
            updateItemId(chain, from, to, id, amount);
        } catch (error) {
            console.log(error);
        }
    });

    contract.on("TransferBatch", async (operator, from, to, ids, amounts) => {
        try {
            for (let i = 0; i < ids.length; i++) {
                updateItemId(chain, from, to, ids[i], amounts[i]);
            }
        } catch (error) {
            console.log(error);
        }
    });

    contract = new ethers.Contract(goldAddress, goldABI, provider);

    contract.on("Transfer", async (from, to, amount) => {
        try {
            updateGold(chain, from, to, amount);
        } catch (error) {
            console.log(error);
        }
    });
}

async function createCharacter(chain, buyer, charId, price, tokenURI) {
    const cid = tokenURI.slice(7, tokenURI.length-14);
    const metadataUrl = `https://ipfs.io/ipfs/${cid}/metadata.json`;
    const metadata = await fetch(metadataUrl);
    const metadataJson = await metadata.json();
                
    let { data, error } = await supabase
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
                currentChain: chain,
            }
        ])
}

async function updateGoldCarried(charId, amount) {
    let { data, error } = await supabase
        .from('Character')
        .select('equippedGold')
        .eq('charId', charId.toString())
    data[0].equippedGold = (Number(amount) + Number(data[0].equippedGold)).toString();
    ({ data, error } = await supabase
        .from('Character')
        .update({equippedGold : data[0].equippedGold})
        .eq('charId', charId.toString()))
}

async function updateItemsEquipped(charId, itemIds) {
    let { data, error } = await supabase
        .from('Character')
        .select('equippedItems')
        .eq('charId', charId.toString())
    for (let i = 0; i < itemIds.length; i++) {
        data[0].equippedItems.push(itemIds[i].toString());
    }
    ({ data, error } = await supabase
        .from('Character')
        .update({equippedItems : data[0].equippedItems})
        .eq('charId', charId.toString()))
}

async function updateCharId(chain, from, to, id) {
    if (Number(from) !== 0) {
        let { data, error } = await supabase
        .from(chain)
        .select('charIds')
        .eq('address', from.toString())
        let charIdsJson =  JSON.parse(data[0].charIds);
        delete charIdsJson[id.toString()];
        ({ data, error } = await supabase
                .from(chain)
                .update({charIds : JSON.stringify(charIdsJson)})
                .eq('address', from.toString()))
    }
    
    if (Number(to) !== 0) {
        let { data, error } = await supabase
        .from(chain)
        .select('*')
        .eq('address', to.toString())
        
        let newCharIds = {};
        if (data.length === 0) {
            newCharIds[id.toString()] = "1";
            data = {address: to.toString(), charIds: JSON.stringify(newCharIds)};
        } else {
            let charIdsJson = JSON.parse(data[0].charIds);
            charIdsJson[id.toString()] = "1";
            data[0].charIds=JSON.stringify(charIdsJson);
        } 
        ({ data, error } = await supabase
                .from(chain)
                .upsert(data))
    }
}

async function updateItemId(chain, from, to, id, amount) {
    if (Number(from) !== 0) {
        let { data, error } = await supabase
        .from(chain)
        .select('itemIds')
        .eq('address', from.toString())
        let itemIdsJson =  JSON.parse(data[0].itemIds);
        let updatedItemIdsAmount = itemIdsJson[id.toString()] - Number(amount);
        if (updatedItemIdsAmount <= 0) {
            delete itemIdsJson[id.toString()];
        } else {
            itemIdsJson[id.toString()] = updatedItemIdsAmount.toString();
        }
        ({ data, error } = await supabase
                .from(chain)
                .update({itemIds : JSON.stringify(itemIdsJson)})
                .eq('address', from.toString()))
    }
    
    if (Number(to) !== 0) {
        let { data, error } = await supabase
        .from(chain)
        .select('*')
        .eq('address', to.toString())
        
        let newItemIds = {};
        if (data.length === 0) {
            newItemIds[id.toString()] = amount.toString();
            data = {address: to.toString(), itemIds: newItemIds};
        } else {
            let itemIdsJson = JSON.parse(data[0].itemIds);
            itemIdsJson[id.toString()] = (Number(amount) + Number(itemIdsJson[id.toString()])).toString();
            data[0].itemIds=JSON.stringify(itemIdsJson);
        } 
        ({ data, error } = await supabase
                .from(chain)
                .upsert(data))
    }
}

async function updateGold(chain, from, to, amount) {
    if (Number(from) !== 0) {
        let { data, error } = await supabase
        .from(chain)
        .select('gold')
        .eq('address', from.toString())
    
        const newGold = Number(data[0].gold) - Number(amount);
        ({ data, error } = await supabase
                .from(chain)
                .update({gold : newGold.toString()})
                .eq('address', from.toString()))
    }
    
    if (Number(to) !== 0) {
        let { data, error } = await supabase
        .from(chain)
        .select('*')
        .eq('address', to.toString())
        
        if (data.length === 0) {
            data = {address: to.toString(), gold: amount.toString()};
        } else {
            data[0].gold = (Number(data[0].gold) + Number(amount)).toString();
        } 
        ({ data, error } = await supabase
                .from(chain)
                .upsert(data))
    }
}

async function updateLevel(charId, level) {
    let { data, error } = await supabase
        .from('Character')
        .update({level : level.toString()})
        .eq('charId', charId.toString())
}

onContractEvents(process.env.RPC_URL_SEPOLIA, "UserInfoChain1", "Sepolia");
updateLevel(1, 5);