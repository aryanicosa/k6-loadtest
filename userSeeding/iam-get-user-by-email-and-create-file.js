/**
 * pre-requisite of this script
 * golang installed
 * k6 installed 
 * xk6 installed : go install go.k6.io/xk6@latest
 * library installed : xk6 build v0.58.0 --with github.com/avitalique/xk6-file@latest
 */

import http from 'k6/http';
import file from 'k6/x/file';
import encoding from 'k6/encoding';
import { check, sleep } from 'k6';
import { SharedArray } from 'k6/data';
import papaparse from 'https://jslib.k6.io/papaparse/5.1.1/index.js';

import { conf } from '../config.js';

const filepath = 'new_users_1K.csv';

const csvData = new SharedArray('another data name', function () {
    // Load CSV file and parse it using Papa Parse
    return papaparse.parse(open('./users_1K.csv'), { header: true }).data;
});

export default function () {
    // Write/append string to file
    file.writeString(filepath, 'email,userId\n');

    // IAM login admin
    const url = `${conf.base_url}/oauth/token`;
    const params = {
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Authorization: `Basic ${encoding.b64encode(`${conf.gameClientId}:`)}`
        }
    };

    const formData = {
        grant_type: 'password',
        username: `${conf.adminEmail}`,
        password: `${conf.adminPassword}`
    };

    const res = http.post(url, formData, params);
    let adminToken = ''

    check(res, {
        'login is OK': r => r && r.status === 200
    });
    
    if (res.status == 200) {
        adminToken = JSON.parse(res.body).access_token;
        // console.log(`${adminToken}`);
    } else {
        console.log(`admin login fail`);
    }
    

    for (const user of csvData) {

        console.log(user.email);
        const userEmail = user.email;

        const formDataUser = {
            grant_type: 'password',
            username: `${userEmail}`,
            password: `${conf.userLoginPassword}`
        };

        const resUser = http.post(url, formDataUser, params);

        const urlGet = `${conf.base_url}/v3/admin/namespaces/${conf.gameNamespace}/users?emailAddress=${userEmail}`;
        const paramsGet = {
            headers: { Authorization: `Bearer ${adminToken}` }
        };

        const resGet = http.get(urlGet, paramsGet);
        let userId = ''

        check(resGet, {
            'get user is OK': rg => rg && rg.status === 200
        })
        
        if (resGet.status == 200) {
            userId = JSON.parse(resGet.body).userId;
            // console.log(`get user by email ok, userId : ${userId}`);
            // console.log(JSON.parse(resGet.body));
        } else {
            console.log(`get user fail: ${resGet.status} : ${resGet.body}`);
        }

        // append the string with data
        file.appendString(filepath, `${userEmail},${userId}\n`);
        sleep(0.1)
    }
}